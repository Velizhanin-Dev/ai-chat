import type { Brief } from "./brief";

// ── Конкуренты в нише: чистый модуль (общий клиенту и серверу) ────────────────
// Ищем в YouTube ролики по нише клиента и показываем те, у которых просмотров
// НЕСОИЗМЕРИМО больше, чем подписчиков у канала: 500 просмотров на 100 подписчиков
// = ×5. Такой ролик выстрелил не на аудитории канала, а на упаковке — то есть его
// название/превью/тему можно разбирать и переносить к себе.
//
// Здесь только типы, константы и математика. Вызовы YouTube — competitors-server.ts.

/** Порядок выдачи search.list (дублирует SearchOrder из youtube.ts — тот модуль серверный). */
export type CompetitorOrder = "viewCount" | "relevance" | "date";

/** Максимум запросов за один поиск. Каждый — 100 units квоты, отсюда потолок. */
export const COMPETITOR_MAX_QUERIES = 5;
/** Стоимость одного search.list в units квоты YouTube Data API. */
export const COMPETITOR_SEARCH_COST = 100;

/** Ролики короче этого — шортсы (YouTube поднял планку до 3 минут). */
export const SHORT_MAX_SECONDS = 180;

export const DEFAULT_MIN_RATIO = 5;
export const DEFAULT_MIN_VIEWS = 1000;

/** Окна поиска. 0 = без ограничения по дате. */
export const COMPETITOR_PERIODS: { value: number; label: string }[] = [
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
  { value: 365, label: "Год" },
  { value: 0, label: "Всё время" },
];

export type CompetitorKind = "all" | "long" | "shorts";

export interface CompetitorVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  duration: string; // ISO-8601
  isShort: boolean;
  views: number;
  likes: number;
  comments: number;
  channelId: string;
  channelTitle: string;
  channelThumb: string | null;
  channelUrl: string | null;
  subscribers: number;
  /** Соотношение просмотров к подписчикам: 500/100 = 5. */
  ratio: number;
  /** По какому запросу нашли (для отладки подбора ключевых слов). */
  query: string;
}

export interface CompetitorResult {
  queries: string[];
  periodDays: number;
  order: CompetitorOrder;
  fetchedAt: string;
  /** Сколько роликов посмотрели до фильтрации (масштаб выборки). */
  scanned: number;
  /** Сколько отсеяли из-за скрытого счётчика подписчиков. */
  hiddenSubs: number;
  /** Все найденные ролики с посчитанным соотношением, по убыванию. Фильтры —
   *  на клиенте: менять порог, не тратя квоту заново. */
  videos: CompetitorVideo[];
}

export interface CompetitorFilters {
  minRatio: number;
  minViews: number;
  kind: CompetitorKind;
}

export const DEFAULT_FILTERS: CompetitorFilters = {
  minRatio: DEFAULT_MIN_RATIO,
  minViews: DEFAULT_MIN_VIEWS,
  kind: "all",
};

/**
 * ISO-8601 длительность → секунды. Своя копия (в youtube-client.ts есть такая же):
 * тот модуль клиентский и тянет за собой обёртки над fetch и localStorage, а этот
 * нужен и на сервере — при разборе выдачи поиска.
 */
export function isoSeconds(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Соотношение просмотров к подписчикам.
 *
 * ⚠️ У канала может быть 0 подписчиков (или счётчик скрыт и API отдал 0) — делим
 * на минимум 1, иначе бесконечность. Скрытый счётчик отсеиваем ДО этого места
 * (там 0 — это «не знаем», а не «нисколько»), а вот честный ноль подписчиков при
 * пяти тысячах просмотров — как раз то, что мы ищем.
 */
export function viewsPerSub(views: number, subscribers: number): number {
  return views / Math.max(subscribers, 1);
}

/** «×5,3» — на карточке это главная цифра, поэтому с одним знаком и запятой. */
export function formatRatio(r: number): string {
  if (!Number.isFinite(r)) return "—";
  if (r >= 100) return `×${Math.round(r)}`;
  return `×${r.toFixed(1).replace(".", ",").replace(",0", "")}`;
}

/** Фильтрация и сортировка выдачи. Чистая — крутится на клиенте без похода на сервер. */
export function applyFilters(
  videos: CompetitorVideo[],
  f: CompetitorFilters
): CompetitorVideo[] {
  return videos
    .filter((v) => {
      if (v.ratio < f.minRatio) return false;
      if (v.views < f.minViews) return false;
      if (f.kind === "shorts" && !v.isShort) return false;
      if (f.kind === "long" && v.isShort) return false;
      return true;
    })
    .sort((a, b) => b.ratio - a.ratio);
}

// ── Подбор ключевых слов ─────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "видео",
  "канал",
  "смотреть",
  "онлайн",
  "новое",
  "новый",
  "подписка",
  "подписаться",
  "лайк",
  "youtube",
  "ютуб",
  "shorts",
  "шортс",
  "влог",
  "vlog",
  "2024",
  "2025",
  "2026",
]);

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ⚠️ Класс символов перечислен буквами, а НЕ через \p{L}/\p{N} с флагом `u`:
// текущий target сборки такие регулярки не принимает (на этом уже спотыкались
// в titleSimilarity — см. CLAUDE.md, раздел про контент-план).
function words(s: string): string[] {
  return normalize(s)
    .toLowerCase()
    .split(/[^0-9a-zа-яё]+/)
    .filter(Boolean);
}

/**
 * Кандидаты в поисковые запросы: теги роликов канала + ниша из брифа.
 *
 * ⚠️ Теги — лучший источник: это буквально лексика ниши словами самого автора, и
 * они уже оплачены квотой (приходят в part=snippet, который мы и так тянем). Ниша
 * из брифа идёт первой строкой — она описывает канал целиком, а тег может быть
 * узким. Возвращаем кандидатов, ВЫБИРАЕТ человек: слепой автоподбор запросов по
 * 100 units за штуку — плохая идея.
 */
export function suggestQueries(input: {
  brief: Brief | null;
  tags: string[];
  channelTitle: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = normalize(raw);
    const key = v.toLowerCase();
    if (!v || v.length < 3 || v.length > 60) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  // Слова названия канала — мусор для поиска конкурентов: по ним найдётся сам
  // канал, а не ниша. Одиночный тег, равный имени канала, выкидываем.
  const brandWords = new Set(words(input.channelTitle));

  const niche = normalize(input.brief?.niche ?? "");
  if (niche) push(niche.slice(0, 60));

  // Частотность тегов: то, что автор ставит на каждый ролик, и есть ядро ниши.
  const freq = new Map<string, { text: string; n: number }>();
  for (const t of input.tags) {
    const v = normalize(t);
    if (!v) continue;
    const key = v.toLowerCase();
    const w = words(v);
    if (w.length === 0 || w.length > 5) continue;
    if (w.every((x) => brandWords.has(x) || STOP_WORDS.has(x))) continue;
    const cur = freq.get(key);
    if (cur) cur.n += 1;
    else freq.set(key, { text: v, n: 1 });
  }

  const ranked = Array.from(freq.values()).sort((a, b) => {
    // Сначала частота, при равной — фразы из 2–3 слов: одиночное слово («ремонт»)
    // слишком широко, длинный хвост — слишком узко.
    if (b.n !== a.n) return b.n - a.n;
    const score = (t: string) => {
      const n = words(t).length;
      return n >= 2 && n <= 3 ? 0 : 1;
    };
    return score(a.text) - score(b.text);
  });

  for (const r of ranked) push(r.text);
  return out.slice(0, 14);
}

/** Нормализация списка запросов, пришедшего с клиента (он же — ключ кэша). */
export function sanitizeQueries(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const v = normalize(String(raw ?? "")).slice(0, 80);
    const key = v.toLowerCase();
    if (v.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= COMPETITOR_MAX_QUERIES) break;
  }
  return out;
}
