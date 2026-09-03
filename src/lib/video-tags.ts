// ── Теги для своего ролика: чистый модуль (клиент/сервер) ────────────────────
//
// Схема от продюсеров студии: у ролика 20 тегов —
//   · 10 ОХВАТНЫХ — их ищут все, конкуренция высокая (нужны, чтобы YouTube отнёс
//     ролик к нише и показал его широкой аудитории);
//   · 8 СВОБОДНЫХ — ищут, а роликов по запросу мало (низкая конкуренция — по ним
//     можно реально биться в поиске);
//   · 2 ИМЕННЫХ — название канала / имя спикера / продукт.
//
// ⚠️⚠️ Главное правило: в итоговые 20 попадает ТОЛЬКО то, что прошло замер через
// страницу выдачи YouTube. Подсказки автодополнения, теги чужих роликов и
// кандидаты от модели — это лишь КАНДИДАТЫ. Продюсеры прямо говорят, что теги,
// которые предлагает сам YouTube, часто плохие; поэтому раскладка по группам идёт
// по замеренным цифрам (сколько смотрят по запросу и сколько по нему роликов), а
// не по тому, кто предложил фразу.
//
// Замер на фразу — те же два честных сигнала, что и в подборе ключей
// (keywords.ts): число роликов по запросу (конкуренция) и просмотры первой
// страницы выдачи (сколько людей по этому запросу уже собрал топ — «охват»).
// «Объёма поиска» как у vidIQ у нас нет и не будет — см. keywords.ts.

import { demandLevel } from "./keywords";

export const TAGS_REACH = 10;
export const TAGS_GAP = 8;
export const TAGS_BRAND = 2;
export const TAGS_TOTAL = TAGS_REACH + TAGS_GAP + TAGS_BRAND;

/** Лимит поля тегов в YouTube Studio: 500 символов на все теги вместе. */
export const YT_TAGS_MAX_CHARS = 500;
/** Один тег длиннее этого — не тег, а предложение; в поле он и не влезет. */
export const TAG_MAX_LENGTH = 60;
/** Сколько кандидатов максимум замеряем: за каждым — страница выдачи. */
export const MAX_TAG_CANDIDATES = 36;
/** Сколько роликов выдачи разбираем на теги-кандидаты. */
export const MAX_TAG_REF_VIDEOS = 8;
/** Тема ролика — что человек вводит в поле. */
export const TAG_TOPIC_MAX_LENGTH = 300;

/** Цена сборки: один вызов модели за кандидатов. Замер выдачи units не тратит. */
export const VIDEO_TAGS_QUOTA_COST = 1;

export type TagSource = "model" | "suggest" | "niche" | "brand";

export interface TagCandidate {
  tag: string;
  source: TagSource;
  /** Фраза пришла из автодополнения YouTube — люди её реально дописывают. */
  suggested: boolean;
  /** Сколько роликов YouTube нашёл по запросу. null — замерить не удалось. */
  totalResults: number | null;
  /** Медиана просмотров первой страницы выдачи. */
  medianViews: number | null;
  /** Сумма просмотров первой страницы — «охват» запроса. */
  topViews: number | null;
}

export interface TagRow {
  tag: string;
  source: TagSource;
  suggested: boolean;
  totalResults: number | null;
  medianViews: number | null;
  topViews: number | null;
}

export type TagGroup = "reach" | "gap" | "brand";

export interface VideoTagSet {
  reach: TagRow[];
  gap: TagRow[];
  brand: TagRow[];
  /** Длина всех тегов через запятую — то, что считает поле Studio. */
  chars: number;
  /** Сколько кандидатов замерили и сколько замерить не удалось. */
  measured: number;
  failed: number;
  /** Сколько кандидатов было всего (после дедупликации). */
  candidates: number;
}

export const TAG_GROUP_META: Record<
  TagGroup,
  { label: string; count: number; hint: string }
> = {
  reach: {
    label: "Охватные",
    count: TAGS_REACH,
    hint: "Их ищут все, роликов по запросу много. Нужны, чтобы YouTube отнёс ролик к нише и показал широкой аудитории.",
  },
  gap: {
    label: "Свободные запросы",
    count: TAGS_GAP,
    hint: "По ним смотрят, а роликов мало. Здесь ролик может реально биться в поиске.",
  },
  brand: {
    label: "Именные",
    count: TAGS_BRAND,
    hint: "Название канала, имя спикера или продукт: связывают ролики канала между собой.",
  },
};

/**
 * Нормализация тега: нижний регистр, без кавычек и решёток, один пробел между
 * словами. Дефис внутри слова оставляем («онлайн-курс», «w204»).
 *
 * ⚠️ Кириллица и латиница перечислены классом, а не через `\p{L}/u`: текущий
 * target сборки такие регулярки не принимает (те же грабли, что в competitors.ts).
 */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[#"'«»“”„`]/g, "")
    .replace(/[^0-9a-zа-яё\-+.& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TAG_MAX_LENGTH)
    .trim();
}

/** Ключ дедупликации: то же, что нормализация, но без дефисов и точек. */
export function tagKey(tag: string): string {
  return normalizeTag(tag).replace(/[-.]/g, "");
}

/** Длина набора тегов так, как её считает поле Studio: теги + запятые между ними. */
export function tagsChars(tags: string[]): number {
  return tags.join(",").length;
}

/** Строка для вставки в поле тегов Studio (запятая с пробелом — Studio пробел срежет). */
export function tagsForClipboard(set: VideoTagSet): string {
  return [...set.reach, ...set.gap, ...set.brand].map((r) => r.tag).join(", ");
}

/** Есть ли по фразе зритель: замеренный спрос либо живая подсказка YouTube. */
function hasDemand(c: TagCandidate): boolean {
  if (c.medianViews !== null && demandLevel(c.medianViews) !== "dead") return true;
  // Подсказка — качественный сигнал спроса, но без просмотров в топе он слабый:
  // на длинных фразах YouTube дописывает и то, что ищут единицы. Поэтому
  // подсказку принимаем, только если топ по ней хоть что-то собирает.
  return c.suggested && (c.topViews ?? 0) >= 10_000;
}

function byReachDesc(a: TagCandidate, b: TagCandidate): number {
  return (
    (b.topViews ?? 0) - (a.topViews ?? 0) ||
    (b.totalResults ?? 0) - (a.totalResults ?? 0) ||
    a.tag.length - b.tag.length
  );
}

function byCompetitionAsc(a: TagCandidate, b: TagCandidate): number {
  return (
    (a.totalResults ?? Infinity) - (b.totalResults ?? Infinity) ||
    (b.topViews ?? 0) - (a.topViews ?? 0) ||
    a.tag.length - b.tag.length
  );
}

function toRow(c: TagCandidate): TagRow {
  return {
    tag: c.tag,
    source: c.source,
    suggested: c.suggested,
    totalResults: c.totalResults,
    medianViews: c.medianViews,
    topViews: c.topViews,
  };
}

/** Дедупликация кандидатов с сохранением порядка; пустые и слишком длинные — вон. */
export function dedupeCandidates(list: TagCandidate[]): TagCandidate[] {
  const seen = new Set<string>();
  const out: TagCandidate[] = [];
  for (const c of list) {
    const tag = normalizeTag(c.tag);
    const key = tagKey(tag);
    if (!tag || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, tag });
  }
  return out;
}

/**
 * Раскладка замеренных кандидатов по схеме 10 / 8 / 2.
 *
 * Порядок: сначала берём то, у чего есть спрос. Охватные — по убыванию охвата
 * (просмотры первой страницы выдачи): это и есть «их ищут все». Свободные — из
 * оставшихся с спросом по ВОЗРАСТАНИЮ числа роликов: «ищут, а видео мало».
 * Если кандидатов со спросом не хватило, добираем остальными замеренными в том же
 * порядке, а незамеренными — в самом конце (по ним цифр нет, и это видно в UI).
 *
 * ⚠️ Бюджет 500 символов соблюдается ЗАМЕНОЙ, а не обрезкой: самый длинный тег
 * меняется на более короткий кандидат той же группы, и только если замены нет —
 * выбрасывается. Обрезать тег посередине нельзя — получится не запрос.
 */
export function assembleTagSet(
  rawCandidates: TagCandidate[],
  brandTags: string[]
): VideoTagSet {
  const brand = dedupeCandidates(
    brandTags.map((tag) => ({
      tag,
      source: "brand" as const,
      suggested: false,
      totalResults: null,
      medianViews: null,
      topViews: null,
    }))
  ).slice(0, TAGS_BRAND);
  const brandKeys = new Set(brand.map((b) => tagKey(b.tag)));

  const candidates = dedupeCandidates(rawCandidates).filter(
    (c) => !brandKeys.has(tagKey(c.tag))
  );
  const measured = candidates.filter((c) => c.totalResults !== null);
  const unmeasured = candidates.filter((c) => c.totalResults === null);

  const withDemand = measured.filter(hasDemand);
  const noDemand = measured.filter((c) => !hasDemand(c));

  // Пулы — упорядоченные списки, из которых группы берут по очереди. Один и тот
  // же кандидат в двух пулах — нормально, занятость проверяется через `used`.
  const reachPool = [
    ...[...withDemand].sort(byReachDesc),
    ...[...noDemand].sort(byReachDesc),
    ...unmeasured,
  ];
  const gapPool = [
    ...[...withDemand].sort(byCompetitionAsc),
    ...[...noDemand].sort(byCompetitionAsc),
    ...unmeasured,
  ];

  const used = new Set<string>();
  const take = (pool: TagCandidate[], n: number): TagCandidate[] => {
    const out: TagCandidate[] = [];
    for (const c of pool) {
      if (out.length >= n) break;
      const key = tagKey(c.tag);
      if (used.has(key)) continue;
      used.add(key);
      out.push(c);
    }
    return out;
  };

  const reach = take(reachPool, TAGS_REACH);
  const gap = take(gapPool, TAGS_GAP);

  // ── Бюджет 500 символов ──────────────────────────────────────────────────
  const allTags = () => [...reach, ...gap, ...brand].map((c) => c.tag);
  let guard = 0;
  while (tagsChars(allTags()) > YT_TAGS_MAX_CHARS && guard++ < 60) {
    // Самый длинный тег среди охватных и свободных (именные не трогаем).
    let group: TagCandidate[] = reach;
    let idx = -1;
    let longest = -1;
    for (const [g, list] of [
      ["reach", reach],
      ["gap", gap],
    ] as const) {
      list.forEach((c, i) => {
        if (c.tag.length > longest) {
          longest = c.tag.length;
          idx = i;
          group = g === "reach" ? reach : gap;
        }
      });
    }
    if (idx === -1) break;

    const pool = group === reach ? reachPool : gapPool;
    const replacement = pool.find(
      (c) => !used.has(tagKey(c.tag)) && c.tag.length < longest
    );
    const removed = group.splice(idx, 1)[0];
    if (replacement) {
      used.add(tagKey(replacement.tag));
      group.push(replacement);
    }
    // Выброшенный тег в пул не возвращаем: он длиннее любой замены.
    void removed;
  }

  return {
    reach: reach.map(toRow),
    gap: gap.map(toRow),
    brand: brand.map(toRow),
    chars: tagsChars(allTags()),
    measured: measured.length,
    failed: unmeasured.length,
    candidates: candidates.length,
  };
}
