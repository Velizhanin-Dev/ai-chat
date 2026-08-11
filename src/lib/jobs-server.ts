import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  isJobKind,
  JOB_MAX_ATTEMPTS,
  JOB_STALE_MS,
  type JobKind,
  type JobStatus,
  type JobView,
} from "@/lib/jobs";

// Серверная часть очереди: постановка, атомарный захват воркером, завершение.
// Брокера нет — очередь живёт в таблице Job (см. комментарий к модели в schema.prisma).

// Обработчик вида задачи. Возвращает то, что уйдёт клиенту как result.
// Бросил исключение → задача уходит в error (или на повтор, если попытки остались).
export type JobHandler = (ctx: {
  jobId: string;
  userId: string;
  conversationId: string | null;
  payload: Record<string, unknown>;
}) => Promise<unknown>;

// Ошибка, которую НЕ надо повторять: повторная попытка либо снова упадёт, либо
// (хуже) заново заплатит провайдеру за уже сделанную работу. Бросается из
// обработчика — воркер сразу помечает задачу проваленной, минуя ретраи.
export class FatalJobError extends Error {
  readonly fatal = true;
  constructor(message: string) {
    super(message);
    this.name = "FatalJobError";
  }
}

export function isFatalJobError(err: unknown): boolean {
  return Boolean((err as { fatal?: boolean } | null)?.fatal);
}

// Реестр обработчиков. Заполняется в job-handlers.ts — так модуль очереди не
// тянет за собой генерацию картинок и YouTube-клиент (воркер импортирует всё, а
// роуты — только эту библиотеку).
const handlers = new Map<JobKind, JobHandler>();

export function registerJobHandler(kind: JobKind, fn: JobHandler): void {
  handlers.set(kind, fn);
}
export function getJobHandler(kind: JobKind): JobHandler | undefined {
  return handlers.get(kind);
}

export function toJobView(row: {
  id: string;
  kind: string;
  status: string;
  conversationId: string | null;
  result: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): JobView {
  return {
    id: row.id,
    kind: (isJobKind(row.kind) ? row.kind : "thumbnail_generate") as JobKind,
    status: row.status as JobStatus,
    conversationId: row.conversationId,
    result: row.result ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

// Ленивый запуск воркера. Зовётся из node-роутов: при постановке задачи и при
// опросе списка активных (последнее важно после рестарта — незаконченные задачи
// подхватятся, как только открытая страница спросит про них).
// startWorker идемпотентен, повторные вызовы бесплатны.
export async function ensureWorker(): Promise<void> {
  const { startWorker } = await import("@/lib/worker");
  startWorker();
}

// Поставить задачу в очередь. Роут вызывает это ВМЕСТО того, чтобы делать работу
// сам, и сразу отдаёт клиенту id.
export async function enqueueJob(args: {
  kind: JobKind;
  userId: string;
  conversationId?: string | null;
  payload: Record<string, unknown>;
}): Promise<JobView> {
  const row = await prisma.job.create({
    data: {
      kind: args.kind,
      userId: args.userId,
      conversationId: args.conversationId ?? null,
      payload: args.payload as unknown as Prisma.InputJsonValue,
    },
  });
  void ensureWorker();
  return toJobView(row);
}

// Атомарный захват одной задачи воркером.
//
// ⚠️ Сырой SQL, а не findFirst+update: между чтением и апдейтом другой воркер
// успел бы взять ту же строку. `FOR UPDATE SKIP LOCKED` — стандартный приём
// очереди на Postgres: конкурент не ждёт блокировку, а просто пропускает строку.
// Пока инстанс один, это перестраховка; когда их станет несколько — здесь уже
// всё готово, менять ничего не придётся.
//
// Забираем и «зависшие» running: если воркер умер, не сняв блокировку, строка
// висела бы вечно. Условие по lockedAt старше JOB_STALE_MS возвращает её в работу.
export async function claimJob(workerId: string): Promise<{
  id: string;
  kind: string;
  userId: string;
  conversationId: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
} | null> {
  const staleBefore = new Date(Date.now() - JOB_STALE_MS);
  const rows = await prisma.$queryRaw<
    {
      id: string;
      kind: string;
      userId: string;
      conversationId: string | null;
      payload: Prisma.JsonValue;
      attempts: number;
    }[]
  >`
    UPDATE "Job" SET
      status = 'running',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      "startedAt" = COALESCE("startedAt", NOW()),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'queued'
         OR (status = 'running' AND "lockedAt" < ${staleBefore})
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, "userId", "conversationId", payload, attempts
  `;
  return rows[0] ?? null;
}

export async function completeJob(jobId: string, result: unknown): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "done",
      result: (result ?? null) as unknown as Prisma.InputJsonValue,
      error: null,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

// Провал попытки. Если попытки ещё остались — возвращаем в очередь, иначе
// фиксируем ошибку (её текст увидит пользователь, поэтому он человеческий).
export async function failJob(
  jobId: string,
  attempts: number,
  message: string,
  // Окончательный сбой — не повторять (см. FatalJobError).
  fatal = false
): Promise<void> {
  const retry = !fatal && attempts < JOB_MAX_ATTEMPTS;
  await prisma.job.update({
    where: { id: jobId },
    data: retry
      ? { status: "queued", lockedAt: null, lockedBy: null, error: message }
      : {
          status: "error",
          error: message,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
  });
}

// Задача пользователя по id. Чужую не отдаём (иначе по перебору id утекали бы
// чужие разборы и превью).
export async function getOwnJob(jobId: string, userId: string): Promise<JobView | null> {
  const row = await prisma.job.findFirst({ where: { id: jobId, userId } });
  return row ? toJobView(row) : null;
}

// Незавершённые задачи — их страница подхватывает после перезагрузки, чтобы
// снова показать индикатор ожидания вместо пустого экрана.
export async function listActiveJobs(args: {
  userId: string;
  conversationId?: string | null;
  kind?: JobKind;
}): Promise<JobView[]> {
  const rows = await prisma.job.findMany({
    where: {
      userId: args.userId,
      status: { in: ["queued", "running"] },
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      ...(args.kind ? { kind: args.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map(toJobView);
}

// Есть ли у пользователя такая же незаконченная задача. Защита от дублей:
// человек тыкает «Сгенерировать» дважды или обновляет страницу с ретраем —
// платить дважды за одно и то же не надо.
export async function findRunningJob(args: {
  userId: string;
  kind: JobKind;
  conversationId?: string | null;
}): Promise<JobView | null> {
  const row = await prisma.job.findFirst({
    where: {
      userId: args.userId,
      kind: args.kind,
      status: { in: ["queued", "running"] },
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? toJobView(row) : null;
}
