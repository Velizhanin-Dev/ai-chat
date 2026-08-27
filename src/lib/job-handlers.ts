import { prisma } from "@/lib/prisma";
import { registerJobHandler, enqueueJob, FatalJobError } from "@/lib/jobs-server";
import { getSettings } from "@/lib/settings";
import { generateImage } from "@/lib/llm/image";
import { readUpload, saveUpload, IMAGE_MIME_EXT } from "@/lib/uploads";
import { buildThumbnailPrompt, normalizeRefRole, type ThumbnailSpec } from "@/lib/thumbnails";
import { normalizePlatform, platformMeta } from "@/lib/platform";
import { spendQuota, toRow } from "@/lib/thumbnails-row";
import { THUMBNAIL_GENERATE_QUOTA_COST } from "@/lib/thumbnails";
import { track } from "@/lib/achievements-server";
import { runChannelDiagnose } from "@/lib/channel-diagnose-server";
import { runVideoAnalyze } from "@/lib/video-analyze-server";
import { generateProfile } from "@/lib/project-profile-server";
import type { DiagnoseKind } from "@/lib/youtube-types";
import {
  BLOCKS,
  BLOCK_META,
  CONTENT_PLAN_GENERATE_QUOTA_COST,
  PLAN_VIDEO_COUNT,
  type BlockKey,
} from "@/lib/content-plan";
import {
  briefFromJson,
  generateBlock,
  generatePlanVideos,
  toPlanView,
} from "@/lib/content-plan-server";

// Обработчики фоновых задач. Сюда переезжает то, что раньше выполнялось внутри
// http-запроса: роут теперь только проверяет доступ и ставит задачу.
//
// ⚠️ Правила для любого обработчика:
//  • квоту списываем ПОСЛЕ успеха (как было в роутах) — упавшая задача бесплатна;
//  • возвращаем ровно то, что раньше уходило в JSON-ответ, чтобы клиент читал
//    результат тем же кодом;
//  • всё, что нужно для работы, лежит в payload: воркер выполняет задачу вне
//    запроса, никакого доступа к cookie/сессии у него нет.

registerJobHandler("thumbnail_generate", async ({ userId, conversationId, payload }) => {
  if (!conversationId) throw new Error("Задача без проекта");

  const spec = payload.spec as ThumbnailSpec;
  const parentId = (payload.parentId as string | null) ?? null;
  const refIds = Array.isArray(payload.refIds) ? (payload.refIds as string[]) : [];

  // Референсы перечитываем ЗДЕСЬ, а не берём из payload: между постановкой и
  // выполнением их могли удалить, и тогда чтение файла упало бы жёстко.
  const refRows = refIds.length
    ? await prisma.thumbnail.findMany({
        where: { id: { in: refIds }, conversationId, kind: "reference" },
      })
    : [];
  const ordered = refIds
    .map((id) => refRows.find((r) => r.id === id))
    .filter((r): r is (typeof refRows)[number] => Boolean(r));

  const projectPlatform = await prisma.conversation
    .findUnique({ where: { id: conversationId }, select: { platform: true } })
    .then((r) => normalizePlatform(r?.platform));

  const prompt = buildThumbnailPrompt(
    spec,
    ordered.map((r) => ({ role: normalizeRefRole(r.role), label: r.label })),
    projectPlatform
  );

  const references = await Promise.all(
    ordered.map(async (r) => ({
      mime: r.mimeType,
      base64: (await readUpload(r.filePath)).toString("base64"),
    }))
  );

  const settings = await getSettings();
  const image = await generateImage({
    prompt,
    references,
    model: settings.imageModel,
    // Формат кадра — по площадке проекта: Reels вертикальные (см. platformMeta).
    aspectRatio: platformMeta(projectPlatform).aspect,
    meta: { userId, conversationId },
  });

  const mime = IMAGE_MIME_EXT[image.mime] ? image.mime : "image/jpeg";

  // ⚠️ Картинка УЖЕ оплачена провайдеру (~$0.14). Если сохранение упадёт —
  // например, из-за прав на папку, — задача уйдёт на повторную попытку и
  // сгенерирует её ЗАНОВО, за новые деньги, ничего не дав пользователю.
  // Поэтому сбой записи помечаем как окончательный: пусть человек нажмёт сам,
  // когда причина устранена, а мы не будем молча жечь бюджет ретраями.
  let filePath: string;
  try {
    filePath = await saveUpload(image.data, { mime, dir: conversationId });
  } catch (err) {
    console.error("[thumbnails] не удалось сохранить картинку:", err);
    throw new FatalJobError(
      "Картинка сгенерирована, но её не удалось сохранить на диск. Сообщите в поддержку — это наша проблема, не ваша."
    );
  }

  const row = await prisma.thumbnail.create({
    data: {
      conversationId,
      userId,
      kind: "generation",
      role: "speaker",
      label: spec.thumbText.slice(0, 120),
      filePath,
      mimeType: mime,
      bytes: image.data.length,
      refIds: ordered.map((r) => r.id),
      parentId,
      spec: spec as unknown as object,
      prompt,
      model: image.model,
      costUsd: image.costUsd,
    },
  });

  // Квота — только после успеха. Пользователь ушёл со страницы, но картинка
  // сделана: списываем, потому что деньги провайдеру мы уже заплатили.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) await spendQuota(user, THUMBNAIL_GENERATE_QUOTA_COST);

  track(userId, "thumbnail_generated");

  return { item: toRow(row) };
});

// ── Контент-план ────────────────────────────────────────────────────────────

registerJobHandler("content_plan_generate", async ({ userId, conversationId, payload }) => {
  if (!conversationId) throw new Error("Задача без проекта");

  const period = String(payload.period ?? "");
  const label = String(payload.label ?? "");

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { brief: true },
  });
  const brief = briefFromJson(conv?.brief);

  const gen = await generatePlanVideos({
    userId,
    projectId: conversationId,
    brief,
    count: PLAN_VIDEO_COUNT,
    periodLabel: label,
  });
  if (gen.length === 0) throw new Error("Не удалось собрать план, попробуйте ещё раз");

  const settings = await getSettings();
  const plan = await prisma.contentPlan.create({
    data: {
      conversationId,
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

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) await spendQuota(user, CONTENT_PLAN_GENERATE_QUOTA_COST);
  track(userId, "content_plan");

  // ⚠️ Цепочка задач: опорные блоки собираются САМИ, следом за планом. Раньше
  // человек жал «Собрать» на каждом блоке руками и ждал у экрана — теперь план
  // приезжает уже укомплектованным. Ставим их отдельными задачами, а не считаем
  // тут же: так каждый блок виден в интерфейсе своим статусом, падение одного не
  // роняет остальные, и повтор попытки работает поблочно.
  for (const block of BLOCKS) {
    await enqueueJob({
      kind: "content_plan_block",
      userId,
      conversationId,
      payload: { planId: plan.id, block },
    });
  }

  return { plan: toPlanView(plan, plan.videos) };
});

registerJobHandler("content_plan_block", async ({ userId, conversationId, payload }) => {
  const planId = String(payload.planId ?? "");
  const block = String(payload.block ?? "") as BlockKey;
  if (!planId || !(BLOCKS as readonly string[]).includes(block)) {
    throw new Error("Неизвестный блок плана");
  }
  if (!conversationId) throw new Error("Задача без проекта");

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { brief: true },
  });

  const gen = await generateBlock({
    userId,
    projectId: conversationId,
    brief: briefFromJson(conv?.brief),
    block,
  });

  if (block === "shorts") {
    const shorts = gen.shorts ?? [];
    if (shorts.length === 0) throw new Error("Не удалось собрать шортсы");
    // Старые сгенерированные шортсы заменяем, ручные не трогаем.
    await prisma.contentPlanVideo.deleteMany({
      where: { planId, kind: "short", source: "ai" },
    });
    const max = await prisma.contentPlanVideo.aggregate({
      where: { planId },
      _max: { order: true },
    });
    let order = (max._max.order ?? -1) + 1;
    await prisma.contentPlanVideo.createMany({
      data: shorts.map((v) => ({
        planId,
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
    // ⚠️ Таблица «блок → поле → что считать пустым» в ОДНОМ месте: раньше это была
    // цепочка тернарников на два блока, и каждый новый требовал править её в двух
    // строках сразу (легко забыть проверку на пустоту и записать пустой массив).
    const saved: Record<string, { data: object; filled: boolean }> = {
      audience: {
        data: { audience: (gen.audience ?? []) as unknown as object },
        filled: Boolean(gen.audience?.length),
      },
      hunt: {
        data: { huntLadder: (gen.hunt ?? []) as unknown as object },
        filled: Boolean(gen.hunt?.length),
      },
      objections: {
        data: { objections: (gen.objections ?? []) as unknown as object },
        filled: Boolean(gen.objections?.length),
      },
      benefits: {
        data: { benefits: (gen.benefits ?? []) as unknown as object },
        filled: Boolean(gen.benefits?.length),
      },
      reasons: {
        data: { reasons: (gen.reasons ?? []) as unknown as object },
        filled: Boolean(gen.reasons?.length),
      },
      funnel: {
        data: { funnelSteps: (gen.funnelSteps ?? []) as unknown as object },
        filled: Boolean(gen.funnelSteps?.length),
      },
    };

    const entry = saved[block];
    if (!entry || !entry.filled) throw new Error("Не удалось собрать блок");
    await prisma.contentPlan.update({ where: { id: planId }, data: entry.data });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) await spendQuota(user, BLOCK_META[block].cost);

  const plan = await prisma.contentPlan.findUnique({
    where: { id: planId },
    include: { videos: { orderBy: { order: "asc" } } },
  });
  if (!plan) throw new Error("План не найден");
  return { plan: toPlanView(plan, plan.videos) };
});

// ── Разбор канала ───────────────────────────────────────────────────────────

registerJobHandler("channel_diagnose", async ({ userId, conversationId, payload }) => {
  if (!conversationId) throw new Error("Задача без проекта");
  const user = await prisma.user.findUnique({ where: { id: userId } });

  return runChannelDiagnose({
    userId,
    userName: user?.name?.trim().slice(0, 100) ?? "",
    conversationId,
    projectId: String(payload.projectId ?? ""),
    kind: (payload.kind ?? "all") as DiagnoseKind,
    periodDays: Number(payload.periodDays ?? 28),
    manualCtr: payload.manualCtr == null ? null : Number(payload.manualCtr),
  });
});

// ── Разбор видео ────────────────────────────────────────────────────────────

registerJobHandler("video_analyze", async ({ userId, conversationId, payload }) => {
  if (!conversationId) throw new Error("Задача без проекта");
  const user = await prisma.user.findUnique({ where: { id: userId } });

  return runVideoAnalyze({
    userId,
    userName: user?.name?.trim().slice(0, 100) ?? "",
    conversationId,
    videoId: String(payload.videoId ?? ""),
    manualCtr: payload.manualCtr == null ? null : Number(payload.manualCtr),
  });
});

// ── Профиль проекта (собирается САМ после брифа) ────────────────────────────
//
// ⚠️ Единственный обработчик, который квоту НЕ списывает: задачу ставит система,
// а не человек (см. ensureProfileJob). Ручная пересборка из настроек идёт мимо
// очереди, своим роутом, и там квота списывается как положено.

registerJobHandler("project_profile", async ({ userId, conversationId }) => {
  if (!conversationId) throw new Error("Задача без проекта");

  const res = await generateProfile({ userId, projectId: conversationId });
  // Бросаем, чтобы сработал штатный ретрай очереди: причина почти всегда
  // временная (провайдер моргнул), а профиль нужен ровно один раз.
  if (res.status !== "ok") throw new Error(res.message);
  return { profile: res.profile };
});
