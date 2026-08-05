import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import {
  CONTENT_PLAN_GENERATE_QUOTA_COST,
  PLAN_VIDEO_COUNT,
  monthKey,
  monthLabel,
  type ContentPlanMeta,
} from "@/lib/content-plan";
import {
  briefFromJson,
  generatePlanVideos,
  toPlanView,
} from "@/lib/content-plan-server";
import { track } from "@/lib/achievements-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // генерация сетки — долгий вызов модели

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
  // Количество роликов ФИКСИРОВАНО (7) — пользователь его не выбирает.
  const count = PLAN_VIDEO_COUNT;
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

  try {
    const gen = await generatePlanVideos({
      userId: user.id,
      projectId: owned,
      brief,
      count,
      periodLabel: label,
    });
    if (gen.length === 0) {
      return apiError("Не удалось собрать план, попробуйте ещё раз", 502, "GEN_ERROR");
    }

    const plan = await prisma.contentPlan.create({
      data: {
        conversationId: owned,
        period,
        label,
        niche: brief?.niche ?? null,
        model: settings.provider === "openrouter" ? settings.openrouterModel : settings.provider,
        videos: {
          create: gen.map((v, i) => ({
            order: i,
            kind: v.kind,
            source: "ai",
            titles: v.titles,
            previewTexts: v.previewTexts,
            format: v.format,
            noSpeaker: v.noSpeaker,
            huntStage: v.huntStage,
            pain: v.pain,
            questions: v.questions,
            nativeClose: v.nativeClose,
            cta: v.cta ?? undefined,
            visp: v.visp ?? undefined,
            reference: v.reference,
            whyWorks: v.whyWorks,
            opening: v.opening,
          })),
        },
      },
      include: { videos: { orderBy: { order: "asc" } } },
    });

    // Списываем квоту (25) после успеха. Админам не списываем.
    if (!isAdmin(user)) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { requestsUsed: { increment: CONTENT_PLAN_GENERATE_QUOTA_COST } },
        })
        .catch((err) => console.error("[content-plan] quota increment error:", err));
    }

    // Геймификация (docs/achievements.md), fire-and-forget.
    track(user.id, "content_plan");

    return NextResponse.json({ plan: toPlanView(plan, plan.videos) });
  } catch (err) {
    console.error("[content-plan generate]", err);
    return apiError("Не удалось собрать план", 502, "GEN_ERROR");
  }
}
