// Фоновые задачи — чистый модуль (общий клиенту и серверу): типы, список видов,
// подписи для UI. Ничего из prisma/node тут быть не должно.
//
// Зачем очередь вообще: генерация превью и контент-плана, разборы канала и видео
// идут десятки секунд. Раньше они выполнялись ВНУТРИ http-запроса — пользователь
// обновлял страницу или уходил, и результат терялся вместе со списанной квотой.
// Теперь роут только ставит задачу и отдаёт её id, а считает воркер.

export const JOB_KINDS = [
  "thumbnail_generate",
  "content_plan_generate",
  "content_plan_block",
  "channel_diagnose",
  "video_analyze",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export function isJobKind(v: unknown): v is JobKind {
  return typeof v === "string" && (JOB_KINDS as readonly string[]).includes(v);
}

// Задача в терминальном состоянии — воркер её больше не тронет, клиент может
// перестать опрашивать.
export function isJobFinished(status: JobStatus): boolean {
  return status === "done" || status === "error" || status === "canceled";
}

// То, что уходит клиенту. payload наружу не отдаём: там внутренние поля
// (пути к файлам, id референсов), клиенту он не нужен.
export interface JobView {
  id: string;
  kind: JobKind;
  status: JobStatus;
  conversationId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// Подписи для индикатора ожидания. Первая — что делаем, вторая — успокаивающая
// приписка: человек должен понимать, что можно уйти со страницы.
export const JOB_LABELS: Record<JobKind, { title: string; hint: string }> = {
  thumbnail_generate: {
    title: "Рисую превью",
    hint: "Займёт до трёх минут. Можно закрыть страницу — результат сохранится.",
  },
  content_plan_generate: {
    title: "Собираю контент-план",
    hint: "Это небыстро. Можно закрыть страницу — план появится тут, когда будет готов.",
  },
  content_plan_block: {
    title: "Собираю опорный блок плана",
    hint: "Портреты ЦА, лестница Ханта, воронка и сетка шортсов собираются автоматически следом за планом.",
  },
  channel_diagnose: {
    title: "Разбираю канал",
    hint: "Поднимаю цифры и считаю параметры. Можно закрыть страницу.",
  },
  video_analyze: {
    title: "Разбираю ролик",
    hint: "Можно закрыть страницу — разбор сохранится.",
  },
};

// Сколько задача может «висеть» в running, прежде чем считать воркера умершим и
// вернуть её в очередь. Верхняя граница — генерация картинки (до 180с по
// OPENROUTER_IMAGE_TIMEOUT_MS), берём с запасом.
export const JOB_STALE_MS = 5 * 60 * 1000;

// Сколько раз пытаться. Внешние сервисы (OpenRouter, YouTube) отдают временные
// 429/5xx, один повтор их закрывает; больше — риск сжечь квоту на сломанной задаче.
export const JOB_MAX_ATTEMPTS = 2;
