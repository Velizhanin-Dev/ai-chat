import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getChannelVideos } from "@/lib/content-plan-channel";
import { planConversation, resyncPlanViews, toPlanView } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";

// POST /api/content-plan/[id]/resync — обновить просмотры/превью у привязанных
// роликов из свежих данных канала. Квоту НЕ тратит (это не вызов модели).
// ?force=1 — мимо кэша канала (кнопка «Обновить цифры»); без него — из кэша
// (авто-вызов при открытии плана, чтобы не долбить YouTube).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const force = new URL(req.url).searchParams.get("force") === "1";
  const res = await getChannelVideos(owned, force);
  if (res.status === "not_connected") return NextResponse.json({ connected: false, updated: 0 });
  if (res.status === "reauth") return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
  if (res.status === "error") return apiError("Не удалось получить данные канала", 502);

  const updated = await resyncPlanViews(id, res.videos);

  const plan = await prisma.contentPlan.findUnique({
    where: { id },
    include: { videos: { orderBy: { order: "asc" } } },
  });
  if (!plan) return apiError("План не найден", 404);
  return NextResponse.json({ connected: true, updated, plan: toPlanView(plan, plan.videos) });
}
