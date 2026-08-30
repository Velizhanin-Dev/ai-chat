import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sanitizeBrief, isBriefComplete, withBriefTerms, type Brief } from "@/lib/brief";
import { routeQuery } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import { buildSystem } from "@/lib/llm/system";
import { getValidAccessToken, fetchVideoFull, fetchVideoRetention } from "@/lib/youtube";
import { fetchVideosByIds } from "@/lib/youtube-search";
import { fetchVideoTags } from "@/lib/youtube-scrape";
import { spendQuota } from "@/lib/thumbnails-row";
import { track } from "@/lib/achievements-server";
import type { VideoAnalysis, RetentionPoint } from "@/lib/youtube-types";

// ИИ-разбор упаковки ролика — вынесен из роута, потому что теперь выполняется
// фоновой задачей: запрос к YouTube + генерация занимают десятки секунд, и уход со
// страницы раньше убивал разбор вместе со списанной квотой.
//
// Работает ВНЕ http-запроса: сессии нет, всё нужное приходит аргументами. Гейты
// (авторизация, владение проектом, квота) остаются в роуте.

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

export interface AnalyzeArgs {
  userId: string;
  userName: string;
  conversationId: string;
  videoId: string;
  manualCtr: number | null;
}

export async function runVideoAnalyze(args: AnalyzeArgs) {
  const { userId, userName, conversationId: owned, videoId, manualCtr } = args;

  const settings = await getSettings();

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

  // Факты ролика: под OAuth — полные (включая кривую удержания из Analytics),
  // для канала по ссылке — публичные (название/описание/метрики + теги скрейпом).
  //
  // ⚠️ Удержания в публичном режиме НЕТ и взять его неоткуда — в промпт вместо
  // кривой уходит прямая оговорка. Молчать нельзя: без неё модель рассуждала бы
  // про «провал на второй минуте», которого не видела (класс ошибок из
  // Антипаттерна №9).
  let facts: {
    title: string;
    description: string;
    tags: string[];
    views: number;
    likes: number;
    comments: number;
  };
  let retLine: string;
  if (integ) {
    const accessToken = await getValidAccessToken(integ);
    const video = await fetchVideoFull(accessToken, videoId);
    if (!video) throw new Error("Видео не найдено");
    const retention = await fetchVideoRetention(accessToken, videoId, video.publishedAt);
    retLine = retentionSummary(retention?.curve ?? [], retention?.avgRelative ?? null);
    facts = {
      title: video.title,
      description: video.description,
      tags: video.tags,
      views: video.viewCount,
      likes: video.likeCount,
      comments: video.commentCount,
    };
  } else {
    const link = await prisma.channelLink.findUnique({
      where: { conversationId: owned },
      select: { id: true },
    });
    if (!link) throw new Error("YouTube не подключён");
    const [video] = await fetchVideosByIds([videoId]);
    if (!video) throw new Error("Видео не найдено");
    const scraped = await fetchVideoTags(videoId).catch(() => null);
    retLine =
      "Удержание: НЕДОСТУПНО — канал привязан по ссылке, кривую досмотров YouTube отдаёт только владельцу. Не рассуждай про удержание и первые секунды так, будто видел цифры; разбирай то, что есть: название, описание, теги и просмотры.";
    facts = {
      title: video.title,
      description: video.description,
      tags: scraped?.tags ?? [],
      views: video.views,
      likes: video.likes,
      comments: video.comments,
    };
  }

  // Роутинг знаний под задачу (ВИСП/книга) — по синтетическому хинту.
  const routeHint =
    "разбери название превью описание и теги youtube-видео по ВИСП, оцени хук и удержание в первые секунды, предложи улучшения упаковки";
  const provider = settings.provider;
  const tRoute0 = Date.now();
  const route = await routeQuery([{ role: "user", content: routeHint }], provider, {
    userId: userId,
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

  const systemBlocks = buildSystem(route, withBriefTerms(route.searchQuery || routeHint, brief), "", brief, userName);
  // Жёсткий формат ИМЕННО этой задачи — строгий JSON (перебивает дисциплину чата).
  systemBlocks.push({
    type: "text",
    text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (важно)\nЭто не чат, а разбор видео. Верни ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг. Содержимое строк — живым моим языком и по моей методике (ВИСП, хук, антипаттерны). Не пиши ничего, кроме JSON.`,
  });

  const genPrompt = `Разбери упаковку моего YouTube-видео и предложи улучшения по моей методике.

ДАННЫЕ РОЛИКА:
Название: «${facts.title}»
Описание:
«${facts.description ? facts.description.slice(0, 1500) : "(пустое)"}»
Теги: ${facts.tags.length ? facts.tags.join(", ") : "(нет)"}
Метрики: просмотров ${facts.views}, лайков ${facts.likes}, комментов ${facts.comments}.
${
  manualCtr != null
  ? `CTR превью (из YouTube Studio, ввёл сам): ${String(manualCtr).replace(".", ",")} %. Норма ~5%, хорошо ~10%; в ЗОЖ/стиле бывает 10–15%. Разбери кликабельность по этой цифре: если ниже нормы — проблема в превью и названии, а не в содержании.`
  : "CTR превью неизвестен (по API он не отдаётся, только в Studio). Не выдумывай его: про кликабельность говори по косвенным признакам и скажи, что точную цифру видно в Studio."
}
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
    orParams: settings.openrouterParams,
    orProvider: settings.openrouterProvider,
    meta: { userId: userId, conversationId: owned },
  })) {
    full += token;
  }

  const analysis = extractAnalysis(full);
  if (!analysis) {
    console.error("[youtube analyze] parse failed:", full.slice(0, 300));
    throw new Error("Не удалось разобрать ответ модели, попробуйте ещё раз");
  }

  // Успех — списываем 1 запрос квоты (как в чате). Админам spendQuota не списывает.
  const userRow = await prisma.user.findUnique({ where: { id: userId } });
  if (userRow) await spendQuota(userRow, 1);

  // Геймификация (docs/achievements.md), fire-and-forget.
  track(userId, "video_analysis");

  return { analysis };
}
