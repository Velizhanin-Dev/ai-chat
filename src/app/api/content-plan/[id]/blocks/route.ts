import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { BLOCKS, BLOCK_META, type BlockKey } from "@/lib/content-plan";
import { briefFromJson, generateBlock, planConversation, toPlanView } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST /api/content-plan/[id]/blocks — сгенерировать опорный блок плана:
// audience | hunt | funnel (1 запрос) или shorts (5 запросов). Возвращает
// обновлённый план целиком.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const body = await readJson(req);
  const block = typeof body?.block === "string" ? body.block : "";
  if (!(BLOCKS as readonly string[]).includes(block)) return apiError("Неизвестный блок");
  const key = block as BlockKey;
  const cost = BLOCK_META[key].cost;

  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: owned },
    select: { brief: true },
  });

  try {
    const gen = await generateBlock({
      userId: user.id,
      projectId: owned,
      brief: briefFromJson(conv?.brief),
      block: key,
    });

    if (key === "shorts") {
      const shorts = gen.shorts ?? [];
      if (shorts.length === 0) {
        return apiError("Не удалось собрать шортсы, попробуйте ещё раз", 502, "GEN_ERROR");
      }
      // Старые сгенерированные шортсы этого плана заменяем (ручные не трогаем).
      await prisma.contentPlanVideo.deleteMany({
        where: { planId: id, kind: "short", source: "ai" },
      });
      const max = await prisma.contentPlanVideo.aggregate({
        where: { planId: id },
        _max: { order: true },
      });
      let order = (max._max.order ?? -1) + 1;
      await prisma.contentPlanVideo.createMany({
        data: shorts.map((v) => ({
          planId: id,
          order: order++,
          kind: "short",
          source: "ai",
          titles: v.titles,
          previewTexts: v.previewTexts,
          pain: v.pain,
          questions: v.questions,
          reference: v.reference,
          opening: v.opening,
          format: v.format,
        })),
      });
    } else {
      const data =
        key === "audience"
          ? { audience: (gen.audience ?? []) as unknown as object }
          : key === "hunt"
            ? { huntLadder: (gen.hunt ?? []) as unknown as object }
            : { funnel: (gen.funnel ?? null) as unknown as object };
      const empty =
        (key === "audience" && !gen.audience?.length) ||
        (key === "hunt" && !gen.hunt?.length) ||
        (key === "funnel" && !gen.funnel);
      if (empty) return apiError("Не удалось собрать блок, попробуйте ещё раз", 502, "GEN_ERROR");
      await prisma.contentPlan.update({ where: { id }, data });
    }

    if (!isAdmin(user)) {
      await prisma.user
        .update({ where: { id: user.id }, data: { requestsUsed: { increment: cost } } })
        .catch((err) => console.error("[content-plan blocks] quota error:", err));
    }

    const plan = await prisma.contentPlan.findUnique({
      where: { id },
      include: { videos: { orderBy: { order: "asc" } } },
    });
    if (!plan) return apiError("План не найден", 404);
    return NextResponse.json({ plan: toPlanView(plan, plan.videos) });
  } catch (err) {
    console.error("[content-plan blocks]", err);
    return apiError("Не удалось собрать блок", 502, "GEN_ERROR");
  }
}
