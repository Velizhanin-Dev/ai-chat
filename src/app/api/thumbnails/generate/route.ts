import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import {
  sanitizeSpec,
  isSpecReady,
  MAX_REFERENCES,
} from "@/lib/thumbnails";
import {
  requireProjectAccess,
  checkQuota,
  THUMBNAIL_GENERATE_QUOTA_COST,
} from "@/lib/thumbnails-server";
import { enqueueJob, findRunningJob } from "@/lib/jobs-server";

// Генерация превью. Роут САМ картинку не рисует — ставит фоновую задачу и отдаёт
// её id (см. src/lib/jobs.ts): генерация идёт до трёх минут, и раньше уход со
// страницы убивал результат вместе со списанной квотой. Работу делает воркер
// (src/lib/job-handlers.ts), квота списывается там же и только после успеха.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";

  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const denied = await checkQuota(access.user);
  if (denied) return denied.res;

  const spec = sanitizeSpec(body?.spec);
  if (!isSpecReady(spec)) {
    return apiError("Опишите, что показать на превью");
  }

  // Перегенерация из редактора — вариация исходного превью. Корнем группы
  // считаем самое первое превью: цепочки «вариация вариации» не плодим, иначе
  // галерея не сможет схлопнуть группу в одну карточку.
  const rawParent = typeof body?.parentId === "string" ? body.parentId : "";
  let parentId: string | null = null;
  if (rawParent) {
    const parent = await prisma.thumbnail.findFirst({
      where: { id: rawParent, conversationId: access.conversationId, kind: "generation" },
      select: { id: true, parentId: true },
    });
    parentId = parent ? parent.parentId ?? parent.id : null;
  }

  // Референсы: берём ТОЛЬКО те, что реально принадлежат этому проекту, и в том
  // порядке, в каком их прислал клиент (порядок = Image 1..N в промпте).
  const wantIds = Array.isArray(body?.refIds)
    ? (body.refIds as unknown[])
        .filter((v): v is string => typeof v === "string")
        .slice(0, MAX_REFERENCES)
    : [];
  const refRows = wantIds.length
    ? await prisma.thumbnail.findMany({
        where: {
          id: { in: wantIds },
          conversationId: access.conversationId,
          kind: "reference",
        },
      })
    : [];
  const ordered = wantIds
    .map((id) => refRows.find((r) => r.id === id))
    .filter((r): r is (typeof refRows)[number] => Boolean(r));

  // Дальше — в фон. Генерация идёт до трёх минут: держать её внутри запроса
  // значило бы терять результат (и списанную квоту) при обновлении страницы.
  // Роут отдаёт id задачи, воркер делает работу, клиент забирает результат по id.
  const dup = await findRunningJob({
    userId: access.user.id,
    kind: "thumbnail_generate",
    conversationId: access.conversationId,
  });
  // Двойной клик / ретрай после обновления страницы — отдаём ту же задачу, а не
  // ставим вторую: каждая генерация стоит денег и 10 единиц квоты.
  if (dup) return NextResponse.json({ job: dup, duplicate: true });

  const job = await enqueueJob({
    kind: "thumbnail_generate",
    userId: access.user.id,
    conversationId: access.conversationId,
    payload: { spec, parentId, refIds: ordered.map((r) => r.id) },
  });

  return NextResponse.json({ job });
}
