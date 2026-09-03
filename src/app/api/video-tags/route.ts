import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import { generateVideoTags } from "@/lib/video-tags-server";
import {
  MAX_TAG_REF_VIDEOS,
  TAG_TOPIC_MAX_LENGTH,
  VIDEO_TAGS_QUOTA_COST,
} from "@/lib/video-tags";

export const dynamic = "force-dynamic";
// Модель + до 36 страниц выдачи по 5 параллельно — это десятки секунд.
export const maxDuration = 180;

// POST /api/video-tags — 20 тегов для своего ролика по схеме 10 охватных / 8
// свободных / 2 именных. Тело: { projectId, topic, refIds?: string[] }.
//
// Стоит VIDEO_TAGS_QUOTA_COST (1 запрос) — за вызов модели, списывается после
// успеха. Замер каждой фразы через выдачу units YouTube не тратит.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, TAG_TOPIC_MAX_LENGTH) : "";
  if (!topic) return apiError("Напиши, о чём ролик");

  const rawIds = Array.isArray(body?.refIds) ? body.refIds : [];
  const refIds = rawIds
    .filter((v: unknown): v is string => typeof v === "string" && /^[\w-]{6,20}$/.test(v))
    .slice(0, MAX_TAG_REF_VIDEOS);

  // Квота: гейт до работы, списание — после успеха (упавшая сборка бесплатна).
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  try {
    const res = await generateVideoTags({ userId: user.id, projectId: owned, topic, refIds });

    if (!isAdmin(user)) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { requestsUsed: { increment: VIDEO_TAGS_QUOTA_COST } },
        })
        .catch((err) => console.error("[quota] increment error:", err));
    }

    return NextResponse.json({ set: res.set });
  } catch (err) {
    console.error("[video-tags]", err);
    return apiError("Не удалось собрать теги, попробуй ещё раз", 502);
  }
}
