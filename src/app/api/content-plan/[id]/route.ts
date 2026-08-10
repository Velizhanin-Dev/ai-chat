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
  return NextResponse.json({ plan: toPlanView(plan, plan.videos) });
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
      status: imported ? "published" : "idea",
      source: imported ? "imported" : "manual",
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
