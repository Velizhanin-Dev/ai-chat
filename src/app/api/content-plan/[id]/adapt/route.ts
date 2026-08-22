import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { CONTENT_PLAN_ADAPT_QUOTA_COST } from "@/lib/content-plan";
import {
  adaptCompetitorVideo,
  briefFromJson,
  competitorTranscriptBlock,
  planConversation,
  toVideoView,
} from "@/lib/content-plan-server";
import { fetchVideoInsight } from "@/lib/competitors-server";
import { videoIdFromUrl } from "@/lib/competitors";

export const dynamic = "force-dynamic";
// Дольше обычной правки: сначала разбор донора и расшифровка, потом генерация.
export const maxDuration = 300;

// POST /api/content-plan/[id]/adapt — переработать залетевший ролик конкурента в
// свою карточку плана (CONTENT_PLAN_ADAPT_QUOTA_COST запросов квоты).
// Тело: { videoId } (или ссылка), опц. { kind: "video"|"short" }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  const conversationId = await planConversation(user.id, id);
  if (!conversationId) return apiError("План не найден", 404);

  const body = await readJson(req);
  const raw = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  // Принимаем и голый id, и ссылку любой формы — из карточки прилетает id, но
  // руками человек скорее вставит ссылку.
  const videoId = /^[\w-]{6,}$/.test(raw) ? raw : videoIdFromUrl(raw);
  if (!videoId) return apiError("Не понял, какой ролик перерабатывать");
  const kind = body?.kind === "short" ? "short" : "video";

  // Квота: гейт до работы, списание — после успеха (упавшая генерация бесплатна).
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  const insightRes = await fetchVideoInsight(videoId);
  if (insightRes.status === "no_keys") {
    return apiError("Разбор роликов не настроен", 503, "CMP_NO_KEYS");
  }
  if (insightRes.status === "quota") {
    return apiError(
      "Лимит запросов к YouTube на сегодня исчерпан — обновится ночью",
      503,
      "CMP_QUOTA"
    );
  }
  if (insightRes.status !== "ok") {
    return apiError("Не удалось получить данные ролика", 502, "CMP_ERROR");
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { brief: true },
  });

  try {
    // Расшифровка — best-effort и параллельно ничему не мешает: она нужна ДО
    // генерации, но за ней ходит внешний сервис, поэтому ошибку не роняем.
    const transcriptBlock = await competitorTranscriptBlock(videoId).catch(
      () => "Расшифровку получить не удалось. Содержание, которого не видел, не пересказывай."
    );

    const gen = await adaptCompetitorVideo({
      userId: user.id,
      projectId: conversationId,
      brief: briefFromJson(conv?.brief ?? null),
      insight: insightRes.insight,
      transcriptBlock,
    });
    if (!gen) return apiError("Не удалось переработать ролик, попробуйте ещё раз", 502, "GEN_ERROR");

    const max = await prisma.contentPlanVideo.aggregate({
      where: { planId: id },
      _max: { order: true },
    });

    const row = await prisma.contentPlanVideo.create({
      data: {
        planId: id,
        order: (max._max.order ?? -1) + 1,
        kind,
        status: "idea",
        // Источник тот же, что у заготовки из «Референсов»: на доске видно, что
        // карточка выросла из чужого ролика.
        source: "competitor",
        titles: gen.titles,
        previewTexts: gen.previewTexts,
        format: gen.format,
        noSpeaker: gen.noSpeaker,
        huntStage: gen.huntStage,
        pain: gen.pain,
        questions: gen.questions,
        nativeClose: gen.nativeClose,
        // Json-поля: Prisma не принимает наши узкие типы напрямую (нет индексной
        // сигнатуры) — приводим, форма проверена нормализатором extractVideos.
        cta: (gen.cta ?? undefined) as Prisma.InputJsonValue | undefined,
        visp: (gen.visp ?? undefined) as Prisma.InputJsonValue | undefined,
        reference: gen.reference,
        whyWorks: gen.whyWorks,
        opening: gen.opening,
      },
    });

    if (!isAdmin(user)) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { requestsUsed: { increment: CONTENT_PLAN_ADAPT_QUOTA_COST } },
        })
        .catch((err) => console.error("[content-plan adapt] quota error:", err));
    }

    return NextResponse.json({ video: toVideoView(row) });
  } catch (err) {
    console.error("[content-plan adapt]", err);
    return apiError("Не удалось переработать ролик", 502, "GEN_ERROR");
  }
}
