import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { CONTENT_PLAN_EDIT_QUOTA_COST, REGEN_PARTS, type RegenPart } from "@/lib/content-plan";
import { briefFromJson, regenerateVideoPart, toVideoView, videoPlanId } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/content-plan/video/[id]/regenerate — переделать часть карточки ИИ
// (1 запрос квоты). Тело: { part: "titles"|"previewTexts"|"questions"|"format" }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  const planId = await videoPlanId(user.id, id);
  if (!planId) return apiError("Ролик не найден", 404);

  const body = await readJson(req);
  const part = typeof body?.part === "string" ? body.part : "";
  if (!(REGEN_PARTS as readonly string[]).includes(part)) return apiError("Неизвестная часть");

  // Квота: 1 запрос. Гейт до генерации, списание — после успеха.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    }
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  const video = await prisma.contentPlanVideo.findUnique({
    where: { id },
    select: {
      titles: true,
      pain: true,
      huntStage: true,
      format: true,
      plan: { select: { conversationId: true, conversation: { select: { brief: true } } } },
    },
  });
  if (!video) return apiError("Ролик не найден", 404);

  try {
    const patch = await regenerateVideoPart({
      userId: user.id,
      projectId: video.plan.conversationId,
      brief: briefFromJson(video.plan.conversation.brief),
      part: part as RegenPart,
      video: {
        titles: video.titles,
        pain: video.pain,
        huntStage: video.huntStage,
        format: video.format,
      },
    });

    const data: Prisma.ContentPlanVideoUpdateInput = {};
    if (patch.titles?.length) data.titles = patch.titles;
    if (patch.previewTexts?.length) data.previewTexts = patch.previewTexts;
    if (patch.questions?.length) data.questions = patch.questions;
    if (part === "format") {
      data.format = patch.format ?? null;
      if (typeof patch.noSpeaker === "boolean") data.noSpeaker = patch.noSpeaker;
    }
    if (Object.keys(data).length === 0) {
      return apiError("Не удалось переделать, попробуйте ещё раз", 502, "GEN_ERROR");
    }

    const row = await prisma.contentPlanVideo.update({ where: { id }, data });

    if (!isAdmin(user)) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { requestsUsed: { increment: CONTENT_PLAN_EDIT_QUOTA_COST } },
        })
        .catch((err) => console.error("[content-plan regen] quota error:", err));
    }

    return NextResponse.json({ video: toVideoView(row) });
  } catch (err) {
    console.error("[content-plan regenerate]", err);
    return apiError("Не удалось переделать", 502, "GEN_ERROR");
  }
}
