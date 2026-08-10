import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import {
  monthKey,
  monthLabel,
  type ContentPlanMeta,
} from "@/lib/content-plan";
import { briefFromJson } from "@/lib/content-plan-server";
import { enqueueJob, findRunningJob } from "@/lib/jobs-server";

export const dynamic = "force-dynamic";


// GET /api/content-plan?projectId= — метаданные планов проекта (свежие сверху).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const plans = await prisma.contentPlan.findMany({
    where: { conversationId: owned },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      period: true,
      label: true,
      niche: true,
      createdAt: true,
      _count: { select: { videos: true } },
      videos: { where: { status: "published" }, select: { id: true } },
    },
  });
  const list: ContentPlanMeta[] = plans.map((p) => ({
    id: p.id,
    period: p.period,
    label: p.label,
    niche: p.niche,
    createdAt: p.createdAt.toISOString(),
    videoCount: p._count.videos,
    publishedCount: p.videos.length,
  }));
  return NextResponse.json({ plans: list });
}

// POST /api/content-plan?projectId= — сгенерировать план на месяц (25 запросов).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const conv = await prisma.conversation.findUnique({
    where: { id: owned },
    select: { brief: true },
  });
  const brief = briefFromJson(conv?.brief);

  const body = await readJson(req);
  const now = new Date();
  const period = typeof body?.period === "string" && body.period ? body.period : monthKey(now);
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : monthLabel(now);

  // Квота: 25 запросов. Гейт до генерации, списание — после успеха.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError("Срок тарифа истёк. Подключите тариф в настройках → Биллинг.", 403, "PLAN_EXPIRED");
    }
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились. Подключите тариф повыше.", 403, "QUOTA_EXCEEDED");
    }
  }

  // Дальше — в фон: сборка плана идёт десятки секунд, а следом за ней воркер сам
  // ставит задачи на опорные блоки (портреты ЦА, лестница Ханта, сетка шортсов).
  // Раньше всё это жило внутри запроса, и обновление страницы сбивало генерацию.
  const dup = await findRunningJob({
    userId: user.id,
    kind: "content_plan_generate",
    conversationId: owned,
  });
  if (dup) return NextResponse.json({ job: dup, duplicate: true });

  const job = await enqueueJob({
    kind: "content_plan_generate",
    userId: user.id,
    conversationId: owned,
    payload: { period, label },
  });
  return NextResponse.json({ job });
}
