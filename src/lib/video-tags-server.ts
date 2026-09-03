// ── Теги для своего ролика: сбор кандидатов, замер, раскладка (сервер) ────────
//
// Три источника кандидатов, все 0 units YouTube:
//   1. автодополнение поиска по теме и её корням (что люди реально дописывают);
//   2. теги верхних роликов текущей выдачи референсов (чем размечают те, у кого в
//      нише уже сработало);
//   3. один структурный вызов модели: тематические + поисковые «от лица зрителя»
//      + два именных (по брифу и названию канала).
//
// ⚠️⚠️ Ни один источник не попадает в итог «как есть»: каждая фраза замеряется
// через страницу выдачи (fetchSearchStats — число роликов + просмотры топа), и
// раскладка по группам 10/8/2 делается по цифрам (video-tags.ts). Продюсеры
// прямо говорят, что теги, которые предлагает сам YouTube, часто плохие.
//
// Стоит VIDEO_TAGS_QUOTA_COST (1 запрос) — за вызов модели. Замер бесплатный.

import { prisma } from "./prisma";
import { getStrategy } from "./llm";
import { buildSystem } from "./llm/system";
import { getSettings, structuredModelOf } from "./settings";
import type { RouteDecision } from "./router";
import { sanitizeBrief, isBriefComplete, type Brief } from "./brief";
import { fetchSearchStats, fetchSuggestions, fetchVideoTags } from "./youtube-scrape";
import { channelHint } from "./competitors-server";
import { searchKeys } from "./competitors";
import { aggregateTags, median } from "./keywords";
import {
  MAX_TAG_CANDIDATES,
  MAX_TAG_REF_VIDEOS,
  TAGS_BRAND,
  assembleTagSet,
  dedupeCandidates,
  normalizeTag,
  type TagCandidate,
  type VideoTagSet,
} from "./video-tags";

/** Сколько страниц выдачи читаем одновременно: сервис скрейпа — маленький VPS. */
const MEASURE_CONCURRENCY = 5;

// Сколько кандидатов берём из каждого источника ДО замера. Пропорции подобраны
// под схему: охватные обычно приходят от модели (тематические) и из тегов ниши,
// свободные — из подсказок и поисковых фраз модели.
const TAKE_MODEL_BROAD = 12;
const TAKE_MODEL_SEARCH = 12;
const TAKE_SUGGEST = 14;
const TAKE_NICHE = 10;

interface ModelCandidates {
  broad: string[];
  search: string[];
  branded: string[];
}

/** Запуск с ограничением параллельности, порядок результатов сохраняется. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function projectBrief(projectId: string): Promise<Brief | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: projectId },
    select: { brief: true },
  });
  const brief = sanitizeBrief(conv?.brief);
  return isBriefComplete(brief) ? brief : null;
}

// ── Источник 1: подсказки автодополнения ─────────────────────────────────────
//
// Тема ролика — это название или фраза целиком, а автодополнение на длинную
// строку молчит. Поэтому спрашиваем и по теме, и по её корням (searchKeys —
// та же логика, что подбирает запросы для поиска референсов), плюс на один
// уровень глубже по верхним подсказкам.
async function suggestCandidates(topic: string): Promise<string[]> {
  const roots = [topic, ...searchKeys(topic).slice(0, 3)];
  const first = await Promise.all(roots.map((r) => fetchSuggestions(r).catch(() => [])));
  const base = first.flat();
  const deeper = await Promise.all(
    base.slice(0, 3).map((phrase) => fetchSuggestions(phrase).catch(() => []))
  );
  return [...base, ...deeper.flat()];
}

// ── Источник 2: теги верхних роликов выдачи ──────────────────────────────────
async function nicheCandidates(refIds: string[]): Promise<string[]> {
  const ids = refIds.slice(0, MAX_TAG_REF_VIDEOS);
  if (ids.length === 0) return [];
  const pages = await Promise.all(ids.map((id) => fetchVideoTags(id).catch(() => null)));
  const withTags = pages.filter((p): p is NonNullable<typeof p> => !!p && p.tags.length > 0);
  // Сперва то, что повторяется у нескольких роликов, — это слова, которыми тему
  // ищут, а не случайные теги одного автора.
  return aggregateTags(withTags, TAKE_NICHE).map((b) => b.tag);
}

// ── Источник 3: модель ───────────────────────────────────────────────────────

function parseModel(raw: string): ModelCandidates | null {
  let t = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map(normalizeTag)
          .filter(Boolean)
          .slice(0, max)
      : [];
  const out = {
    broad: list(o.broad, TAKE_MODEL_BROAD),
    search: list(o.search, TAKE_MODEL_SEARCH),
    branded: list(o.branded, TAGS_BRAND),
  };
  return out.broad.length + out.search.length + out.branded.length > 0 ? out : null;
}

async function modelCandidates(opts: {
  userId: string;
  projectId: string;
  topic: string;
  brief: Brief | null;
  channelTitle: string;
  suggestions: string[];
  niche: string[];
}): Promise<ModelCandidates | null> {
  const settings = await getSettings();
  const provider = settings.provider;

  // Роутер знаний не зовём и ретрив выключен: правила подбора тегов (три типа,
  // «от лица зрителя», без чужих имён, только по-русски) написаны словами в
  // задании ниже, а на выходе JSON — см. тот же приём в /api/thumbnails/spec.
  const route: RouteDecision = {
    category: "chat",
    book: false,
    formats: false,
    contentPlan: false,
    tgClosed: false,
    tgOpen: false,
    youtube: false,
    charisma: false,
    searchQuery: "",
  };

  const systemBlocks = buildSystem(route, "", "", opts.brief, "", null, "off", [], null, true);
  systemBlocks.push({
    type: "text",
    text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (строго)\nЭто не чат, а подбор кандидатов в теги ролика. Верни ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг.`,
  });

  const b = opts.brief;
  const briefLines = b
    ? [
        b.niche && `Ниша: ${b.niche}`,
        b.audience && `ЦА: ${b.audience}`,
        b.product && `Что продвигает: ${b.product}`,
        b.expertise && `Экспертность спикера: ${b.expertise}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const channelLine = opts.channelTitle
    ? `Канал: ${opts.channelTitle}`
    : b?.channel
      ? `Канал: ${b.channel}`
      : "";

  const prompt = `Подбери кандидатов в теги для ролика на YouTube. Теги — это поисковые запросы: слово или фраза, которыми зритель ищет.

О ЧЁМ РОЛИК:
${opts.topic}
${[channelLine, briefLines].filter(Boolean).join("\n")}
${
  opts.suggestions.length
    ? `\nЧто люди реально дописывают в поиске YouTube по этой теме (подсказки автодополнения):\n${opts.suggestions.slice(0, 20).join(", ")}`
    : ""
}${
  opts.niche.length
    ? `\nЧем размечают ролики, которые в этой нише уже выстрелили:\n${opts.niche.join(", ")}`
    : ""
}

Верни СТРОГО валидный JSON:
{"broad":["...","..."],"search":["...","..."],"branded":["...","..."]}

Требования:
- broad — ${TAKE_MODEL_BROAD} ТЕМАТИЧЕСКИХ тегов: короткие (1-3 слова), высокочастотные — тема ролика и его ниша теми словами, которыми её ищут все. От широкого к более узкому: сначала ниша целиком, потом тема ролика, потом её ближайшие соседи.
- search — ${TAKE_MODEL_SEARCH} ПОИСКОВЫХ тегов «от лица зрителя»: встань на место человека и спроси его словами, по какому запросу он наткнулся бы на этот ролик (2-5 слов). Вопросительные и утвердительные формулировки — обе годятся. Конкретика ролика, а не общие слова.
- branded — ${TAGS_BRAND} ИМЕННЫХ тега: название канала или имя и фамилия спикера, и продукт/компания, которую ролик продвигает. Только то, что видно из данных выше; ничего не выдумывай.
- Всё в нижнем регистре, без хэштегов, кавычек и знаков препинания. Только по-русски: латиница допустима лишь в названиях сервисов, брендов и моделей (minecraft, w204).
- Без чужих имён, каналов и брендов, о которых ролик не рассказывает. Без синонимов-дублей одного и того же. Каждый тег — про ЭТОТ ролик.
Только JSON, ничего кроме него.`;

  const strategy = getStrategy(provider);
  let full = "";
  for await (const token of strategy.stream({
    system: systemBlocks,
    messages: [{ role: "user", content: prompt }],
    route,
    routeMs: 0,
    model: structuredModelOf(settings).model,
    orParams: settings.openrouterParams,
    orProvider: structuredModelOf(settings).orProvider,
    meta: { userId: opts.userId, conversationId: opts.projectId },
  })) {
    full += token;
  }
  const parsed = parseModel(full);
  if (!parsed) console.error("[video-tags] parse failed:", full.slice(0, 300));
  return parsed;
}

// ── Замер ────────────────────────────────────────────────────────────────────

/** Дописать в кандидатов цифры выдачи. Не достали — остаётся null, это штатно. */
async function measure(list: TagCandidate[]): Promise<TagCandidate[]> {
  return mapLimit(list, MEASURE_CONCURRENCY, async (c) => {
    const res = await fetchSearchStats(c.tag).catch(() => null);
    if (!res) {
      console.warn("[video-tags] не удалось прочитать выдачу по тегу:", c.tag);
      return c;
    }
    const views = res.top.map((v) => v.views).filter((v) => v > 0);
    return {
      ...c,
      totalResults: res.totalResults,
      medianViews: median(views),
      topViews: views.reduce((a, v) => a + v, 0),
    };
  });
}

function candidate(tag: string, source: TagCandidate["source"], suggested = false): TagCandidate {
  return { tag, source, suggested, totalResults: null, medianViews: null, topViews: null };
}

export interface VideoTagsOutcome {
  status: "ok";
  set: VideoTagSet;
}

/**
 * Полный цикл: кандидаты → замер → раскладка 10/8/2.
 *
 * Модель и бесплатные источники идут параллельно, и замер бесплатных кандидатов
 * начинается, не дожидаясь модели, — так общее время ≈ max(модель, замер), а не
 * их сумма.
 */
export async function generateVideoTags(opts: {
  userId: string;
  projectId: string;
  topic: string;
  refIds: string[];
}): Promise<VideoTagsOutcome> {
  const [brief, hint] = await Promise.all([
    projectBrief(opts.projectId),
    channelHint(opts.projectId),
  ]);

  const [suggestions, niche] = await Promise.all([
    suggestCandidates(opts.topic),
    nicheCandidates(opts.refIds),
  ]);

  const free = dedupeCandidates([
    ...suggestions.map((t) => candidate(t, "suggest", true)),
    ...niche.map((t) => candidate(t, "niche")),
  ]).slice(0, TAKE_SUGGEST + TAKE_NICHE);

  const [model, measuredFree] = await Promise.all([
    modelCandidates({
      userId: opts.userId,
      projectId: opts.projectId,
      topic: opts.topic,
      brief,
      channelTitle: hint.channelTitle,
      suggestions,
      niche,
    }),
    measure(free),
  ]);

  // Кандидаты модели: только те, что ещё не замерены среди бесплатных, и в
  // пределах общего потолка (за каждым — страница выдачи).
  const room = Math.max(0, MAX_TAG_CANDIDATES - measuredFree.length);
  const fromModel = dedupeCandidates([
    ...(model?.broad ?? []).map((t) => candidate(t, "model")),
    ...(model?.search ?? []).map((t) => candidate(t, "model")),
  ]);
  const measuredKeys = new Set(measuredFree.map((c) => normalizeTag(c.tag)));
  const modelOnly = fromModel.filter((c) => !measuredKeys.has(c.tag)).slice(0, room);
  const measuredModel = await measure(modelOnly);

  // Именные: от модели, а если она не дала — название канала и продукт из брифа.
  const brandFallback = [
    hint.channelTitle || brief?.channel || "",
    brief?.product ? searchKeys(brief.product)[0] ?? "" : "",
  ].filter(Boolean);
  const branded = [...(model?.branded ?? []), ...brandFallback];

  const set = assembleTagSet([...measuredFree, ...measuredModel], branded);
  return { status: "ok", set };
}
