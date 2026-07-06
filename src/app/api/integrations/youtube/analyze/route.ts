import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";
import { routeQuery } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import { buildSystem } from "@/lib/llm/system";
import {
  getValidAccessToken,
  fetchVideoFull,
  fetchVideoRetention,
  assertOwnedProject,
} from "@/lib/youtube";
import type { RetentionPoint, VideoAnalysis } from "@/lib/youtube-types";

// ИИ-разбор упаковки видео (название/описание/теги/удержание) с вариантами по
// методике. ТРАТИТ 1 запрос квоты (как ответ в чате). Возвращает структурный JSON.

// Краткое текстовое описание кривой удержания для промпта.
function retentionSummary(curve: RetentionPoint[], avgRelative: number | null): string {
  if (curve.length === 0) return "Данных по удержанию мало (у ролика немного просмотров).";
  const at = (r: number) => {
    const pt = curve.reduce((best, c) =>
      Math.abs(c.ratio - r) < Math.abs(best.ratio - r) ? c : best
    );
    return Math.round(pt.watchRatio * 100);
  };
  const rel =
    avgRelative != null
      ? ` Против похожих роликов на YouTube — ${Math.round(avgRelative * 100)}% (0.5 = как у похожих).`
      : "";
  return `Удержание: старт 100%, к 5% ролика ${at(0.05)}%, к 25% — ${at(0.25)}%, к 50% — ${at(
    0.5
  )}%, к концу ${at(1)}%.${rel} Резкий провал в начале = слабый хук.`;
}

// Достаём валидный JSON из ответа модели (может прийти в ```json-обёртке или с
// текстом вокруг). Нормализуем поля.
function extractAnalysis(text: string): VideoAnalysis | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const strArr = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
      : [];
  const summary = (o.summary ?? {}) as Record<string, unknown>;
  const good = strArr(summary.good, 6);
  const bad = strArr(summary.bad, 6);
  const titles = strArr(o.titles, 5);
  const description = typeof o.description === "string" ? o.description.trim() : "";
  const tags = strArr(o.tags, 20);
  if (!good.length && !bad.length && !titles.length && !description) return null;
  return { summary: { good, bad }, titles, description, tags };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!videoId) return apiError("Не указан videoId");

  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  // Бриф проекта — источник контекста о спикере/нише (как в чате).
  const conv = await prisma.conversation.findUnique({
    where: { id: owned },
    select: { brief: true },
  });
  const brief: Brief | null = isBriefComplete(sanitizeBrief(conv?.brief))
    ? sanitizeBrief(conv?.brief)
    : null;

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (!integ) return apiError("YouTube не подключён", 404);

  // Квота: разбор тратит 1 запрос (как ответ в чате). Админам не лимитируем.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError(
        "Срок тарифа истёк. Подключите тариф в настройках → Биллинг.",
        403,
        "PLAN_EXPIRED"
      );
    }
    if (quota.reason === "quota") {
      return apiError(
        "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
        403,
        "QUOTA_EXCEEDED"
      );
    }
  }

  try {
    const accessToken = await getValidAccessToken(integ);
    const video = await fetchVideoFull(accessToken, videoId);
    if (!video) return apiError("Видео не найдено", 404);
    const retention = await fetchVideoRetention(accessToken, videoId, video.publishedAt);

    const retLine = retentionSummary(retention?.curve ?? [], retention?.avgRelative ?? null);

    // Роутинг знаний под задачу (ВИСП/книга) — по синтетическому хинту.
    const routeHint =
      "разбери название превью описание и теги youtube-видео по ВИСП, оцени хук и удержание в первые секунды, предложи улучшения упаковки";
    const provider = settings.provider;
    const tRoute0 = Date.now();
    const route = await routeQuery([{ role: "user", content: routeHint }], provider, {
      userId: user.id,
      conversationId: owned,
    });
    const routeMs = Date.now() - tRoute0;
    // Тюним промпт под ЭТУ задачу (упаковка = ВИСП), чтобы резать латентность —
    // особенно на GLM, где префилл 20–30К токенов даёт ttft 30–60с:
    //  • category→"chat" — стратегия отключает extended thinking (для Claude −40с),
    //    и не добавляется OUTPUT_DISCIPLINE (вместо неё свой блок формата JSON ниже);
    //  • book/formats/contentPlan→false — книга (длинные сценарии) и форматы шортсов
    //    для разбора названия/описания/тегов не нужны, а это основной объём токенов;
    //  • TG (ВИСП) оставляем — это ядро знаний по названиям/превью/описанию.
    route.category = "chat";
    route.book = false;
    route.formats = false;
    route.contentPlan = false;

    const userName = user.name?.trim().slice(0, 100) ?? "";
    const systemBlocks = buildSystem(route, route.searchQuery || routeHint, "", brief, userName);
    // Жёсткий формат ИМЕННО этой задачи — строгий JSON (перебивает дисциплину чата).
    systemBlocks.push({
      type: "text",
      text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (важно)\nЭто не чат, а разбор видео. Верни ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг. Содержимое строк — живым моим языком и по моей методике (ВИСП, хук, антипаттерны). Не пиши ничего, кроме JSON.`,
    });

    const genPrompt = `Разбери упаковку моего YouTube-видео и предложи улучшения по моей методике.

ДАННЫЕ РОЛИКА:
Название: «${video.title}»
Описание:
«${video.description ? video.description.slice(0, 1500) : "(пустое)"}»
Теги: ${video.tags.length ? video.tags.join(", ") : "(нет)"}
Метрики: просмотров ${video.viewCount}, лайков ${video.likeCount}, комментов ${video.commentCount}.
${retLine}

Верни СТРОГО валидный JSON без markdown и без текста вокруг:
{"summary":{"good":["..."],"bad":["..."]},"titles":["...","...","..."],"description":"...","tags":["...","..."]}

Требования (всё на русском, в моём голосе, по методике):
- summary.good и summary.bad — по 2–4 коротких конкретных пункта (что сильно / что слабо в названии, описании, хуке и удержании).
- titles — 3 разных сильных названия по ВИСП (выгода/интрига/срочность/причастность + страх), живые, НЕ в два предложения, без ярлыков вроде «(шокирующее)».
- description — переписанное описание: первые 1–2 строки цепляют и раскрывают выгоду, дальше суть, в конце уместный СТА. Без канцелярита.
- tags — 8–15 релевантных тегов нижним регистром (ниша + тема + смежные запросы).
Только JSON, ничего кроме него.`;

    const strategy = getStrategy(provider);
    let full = "";
    for await (const token of strategy.stream({
      system: systemBlocks,
      messages: [{ role: "user", content: genPrompt }],
      route,
      routeMs,
      model: settings.openrouterModel,
      meta: { userId: user.id, conversationId: owned },
    })) {
      full += token;
    }

    const analysis = extractAnalysis(full);
    if (!analysis) {
      console.error("[youtube analyze] parse failed:", full.slice(0, 300));
      return apiError("Не удалось разобрать ответ модели, попробуйте ещё раз", 502, "YT_ERROR");
    }

    // Успех — списываем 1 запрос квоты (как в чате). Админам не списываем.
    if (!isAdmin(user)) {
      await prisma.user
        .update({ where: { id: user.id }, data: { requestsUsed: { increment: 1 } } })
        .catch((err) => console.error("[youtube analyze] quota increment error:", err));
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    if (status === 401 || status === 403 || msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[youtube analyze]", err);
    return apiError("Не удалось разобрать видео", 502, "YT_ERROR");
  }
}
