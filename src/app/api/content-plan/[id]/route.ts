import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { planConversation, toPlanView, toVideoView } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";

// GET /api/content-plan/[id] — полный план (со всеми роликами).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const plan = await prisma.contentPlan.findUnique({
    where: { id },
    include: { videos: { orderBy: { order: "asc" } } },
  });
  if (!plan) return apiError("План не найден", 404);

  // ⚠️ Колонки «В работе» и «Опубликовано» — СКВОЗНЫЕ по всем планам проекта.
  // Ролик заводят в плане одного месяца, а снимают и публикуют в следующем: при
  // переключении месяца такие карточки исчезали с доски, и люди считали, что
  // потеряли работу. Своими (plan.videos) они при этом НЕ становятся — счётчики
  // и опорные блоки по-прежнему считаются по своему плану.
  const carriedRows = await prisma.contentPlanVideo.findMany({
    where: {
      planId: { not: id },
      // Свалка тоже сквозная: это входящий ящик ПРОЕКТА, а не месяца. Идея,
      // записанная в июле, должна быть под рукой, когда в августе садишься
      // собирать новый план, — иначе смысл свалки теряется.
      status: { in: ["dump", "in_progress", "published"] },
      plan: { conversationId: owned },
    },
    orderBy: [{ status: "asc" }, { order: "asc" }],
    include: { plan: { select: { label: true } } },
    // Потолок на случай многолетнего проекта: доска не должна превращаться в
    // архив на пятьсот карточек.
    take: 60,
  });
  const carried = carriedRows.map((v) => ({ ...v, planLabel: v.plan.label }));

  return NextResponse.json({ plan: toPlanView(plan, plan.videos, carried) });
}

// DELETE /api/content-plan/[id] — удалить план (каскадом — ролики).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);
  await prisma.contentPlan.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST /api/content-plan/[id]/video через этот же роут (action=addVideo) — добавить
// ролик вручную (бесплатно). Тело: { kind?, title?, format? }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const body = await readJson(req);
  const kind = body?.kind === "short" ? "short" : "video";
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 300) : "";
  // Импорт опубликованного ролика канала: сразу привязан + статус «опубликовано».
  const ytId = typeof body?.youtubeVideoId === "string" ? body.youtubeVideoId : "";
  const imported = ytId.length > 0;
  // Заведение карточки из «Референсов»: ссылка на ролик-донор + пометка источника,
  // чтобы на доске было видно, что название тут — заготовка под переписывание.
  const reference =
    typeof body?.reference === "string" ? body.reference.trim().slice(0, 500) : "";
  const fromCompetitor = !imported && reference.length > 0;
  // Карточка «в свалку»: сырая запись без методики, её ещё предстоит превратить
  // в тему. Значение принимаем только это одно — статусами карточка ходит по
  // доске, а не задаётся произвольно при создании.
  const toDump = body?.status === "dump";

  const max = await prisma.contentPlanVideo.aggregate({
    where: { planId: id },
    _max: { order: true },
  });
  const order = (max._max.order ?? -1) + 1;

  const row = await prisma.contentPlanVideo.create({
    data: {
      planId: id,
      order,
      kind,
      status: imported ? "published" : toDump ? "dump" : "idea",
      source: imported ? "imported" : fromCompetitor ? "competitor" : "manual",
      reference: reference || null,
      titles: title ? [title] : [],
      previewTexts: [],
      questions: [],
      youtubeVideoId: imported ? ytId : null,
      thumbnail: imported && typeof body?.thumbnail === "string" ? body.thumbnail : null,
      views: imported && typeof body?.views === "number" ? Math.round(body.views) : null,
    },
  });
  return NextResponse.json({ video: toVideoView(row) });
}
