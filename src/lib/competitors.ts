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
/** Стоимость одной СТРАНИЦЫ search.list в units квоты YouTube Data API. */
export const COMPETITOR_SEARCH_COST = 100;

/** Сколько роликов приходит за одну страницу выдачи (жёсткий лимит search.list). */
export const COMPETITOR_PAGE_SIZE = 50;

// Сколько подходящих (уже прошедших фильтры) роликов должно быть в выдаче, чтобы
// поиск остановился. Меньше — экран выглядит пустым: сырых роликов приезжает
// полсотни, но после порога «просмотров кратно больше, чем подписчиков» их
// остаются единицы, и человек не понимает, работает раздел или нет.
export const COMPETITOR_TARGET_RESULTS = 20;

// Порог уведомления «у конкурента залетело». ⚠️ Он ВЫШЕ обычного фильтра раздела:
// ×3 — нормальный порог, чтобы разобрать ролик руками, а в телеграм должно
// попадать только то, ради чего не жалко звука на телефоне.
export const ALERT_MIN_RATIO = 5;
export const ALERT_MIN_VIEWS = 1000;
export const ALERT_WINDOW_DAYS = 14;

// ⚠️ Потолок автодогрузки за одно нажатие «Найти». Каждая страница — 100 units на
// КАЖДЫЙ живой запрос (у пяти запросов страница стоит 500 из 10 000 суточных на
// ключ). Без потолка узкая ниша, где двадцати подходящих роликов просто нет,
// вычерпает выдачу до конца (~500 результатов) и сожжёт дневную квоту.
export const COMPETITOR_MAX_AUTO_PAGES = 4;

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
  /** Сколько страниц выдачи уже загрузили (по 50 роликов на запрос). */
  pagesLoaded: number;
  /** Есть ли у YouTube ещё страницы хоть по одному запросу. */
  hasMore: boolean;
  /** Во сколько units обойдётся следующая страница (100 × запросов с продолжением). */
  nextCost: number;
  fetchedAt: string;
  /** Сколько роликов посмотрели до фильтрации (масштаб выборки). */
  scanned: number;
  /** Сколько отсеяли из-за скрытого счётчика подписчиков. */
  hiddenSubs: number;
  /** Сколько выкинули как иноязычные (работаем только по русскоязычной нише). */
  foreign: number;
  /** Все найденные ролики с посчитанным соотношением, по убыванию. Фильтры —
   *  на клиенте: менять порог, не тратя квоту заново. */
  videos: CompetitorVideo[];
}

// ── Конкуренты-КАНАЛЫ (а не отдельные ролики-референсы) ──────────────────────
//
// ⚠️ «Похожих каналов» в YouTube Data API нет: related-channels выпилены, а
// search.list?type=channel матчит только название и описание канала (и стоит те же
// 100 units). Поэтому каналы ниши собираем из ДВУХ сигналов, оба почти бесплатные:
//  1. агрегация уже найденной выдачи роликов — канал, у которого в нише выстрелил
//     не один ролик, и есть конкурент (0 дополнительных units: channels.list по этим
//     каналам мы уже сделали ради подписчиков и аватара);
//  2. «рекомендованные каналы» самих этих каналов (channelSections, 1 unit на канал) —
//     то, что автор руками поставил себе на страницу, почти всегда коллеги по нише.
export type ChannelSource = "search" | "featured" | "manual";

export interface CompetitorChannel {
  id: string;
  title: string;
  thumbnail: string | null;
  url: string;
  subscribers: number;
  videoCount: number;
  /** Как нашли: по выдаче роликов или через «рекомендованные» у другого канала. */
  source: ChannelSource;
  /** Сколько его роликов попало в нашу выдачу (для source="featured" — 0). */
  hits: number;
  /** Медианная кратность «просмотры/подписчики» по этим роликам. */
  medianRatio: number;
  /** Лучший его ролик из выдачи — что именно у него выстрелило. */
  topVideo: { id: string; title: string; views: number; ratio: number } | null;
  /** Кто его рекомендует (название канала-донора) — только у source="featured". */
  recommendedBy: string | null;
  /** id строки в БД — только у добавленных руками (по нему удаляем). */
  trackedId?: string;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Каналы из выдачи роликов: группируем по каналу и считаем, сколько его роликов
 * вылетело за свою аудиторию.
 *
 * ⚠️ Сортируем по ЧИСЛУ выстреливших роликов, а потом по медианной кратности, а не
 * по одному лучшему: один залетевший ролик — случайность, три — уже система, и
 * разбирать имеет смысл именно такой канал.
 */
export function aggregateChannels(
  videos: CompetitorVideo[],
  f: CompetitorFilters
): CompetitorChannel[] {
  const byChannel = new Map<string, CompetitorVideo[]>();
  for (const v of applyFilters(videos, f)) {
    if (!v.channelId) continue;
    const list = byChannel.get(v.channelId);
    if (list) list.push(v);
    else byChannel.set(v.channelId, [v]);
  }

  // ⚠️ forEach, а не for…of по Map: текущий target сборки не даёт итерировать Map
  // без downlevelIteration (те же грабли, что с Set в words() и titleSimilarity).
  const rows: CompetitorChannel[] = [];
  byChannel.forEach((list, id) => {
    const top = list.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    rows.push({
      id,
      title: top.channelTitle,
      thumbnail: top.channelThumb,
      url: top.channelUrl ?? `https://www.youtube.com/channel/${id}`,
      subscribers: top.subscribers,
      videoCount: 0,
      source: "search",
      hits: list.length,
      medianRatio: median(list.map((v) => v.ratio)),
      topVideo: { id: top.id, title: top.title, views: top.views, ratio: top.ratio },
      recommendedBy: null,
    });
  });
  return rows.sort((a, b) => b.hits - a.hits || b.medianRatio - a.medianRatio);
}

// Лента новых роликов отслеживаемых каналов + их динамика по нашим снимкам.
export interface TrackedChannelRow {
  trackedId: string;
  channelId: string;
  title: string;
  thumbnail: string | null;
  url: string;
  subscribers: number;
  videoCount: number;
  /** Прирост подписчиков в неделю по НАШИМ снимкам (null — снимков ещё мало). */
  subsPerWeek: number | null;
  /** Сколько дней уже копим цифры этого канала. */
  trackedDays: number;
  /** Сколько его роликов попало в ленту за окно. */
  fresh: number;
}

export interface TrackedFeedResult {
  channels: TrackedChannelRow[];
  /** Новые ролики всех отслеживаемых каналов за окно, по убыванию кратности. */
  videos: CompetitorVideo[];
  days: number;
  fetchedAt: string;
}

export interface NicheChannelsResult {
  channels: CompetitorChannel[];
  /** Из скольких каналов выдачи спрашивали «рекомендованные». */
  expandedFrom: number;
  fetchedAt: string;
}

// ── Разбор конкретного ролика-референса ─────────────────────────────────────
//
// ⚠️ Что реально доступно по чужому ролику: название, ОПИСАНИЕ (часто с тайм-кодами,
// то есть фактически структурой), метрики и топ-комментарии. Чего нет и не будет:
// теги (с 2021 их видит только владелец) и транскрипт (`captions.download` требует
// OAuth владельца канала). Поэтому «разобрать референс» = разобрать упаковку,
// заявленную структуру и реакцию зрителей, а не пересказать содержание.
export interface VideoInsight {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  duration: string;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  description: string;
  topComments: { text: string; likes: number }[];
}

/** id ролика из ссылки любой формы (в reference лежит именно ссылка). */
export function videoIdFromUrl(input: string): string | null {
  const m =
    /youtu\.be\/([\w-]{6,})/.exec(input) ??
    /[?&]v=([\w-]{6,})/.exec(input) ??
    /\/shorts\/([\w-]{6,})/.exec(input) ??
    /\/live\/([\w-]{6,})/.exec(input);
  return m ? m[1] : null;
}

/**
 * Блок про референс для промпта ассистента.
 *
 * ⚠️ Оговорки «ролик я не смотрел, расшифровки нет» тут НЕТ намеренно (убрана по
 * просьбе владельца): текст уходит в чат ОТ ЛИЦА ПОЛЬЗОВАТЕЛЯ, и в его сообщении
 * такое признание читается как оправдание. От выдумывания содержания модель
 * держит Антипаттерн №9 (запрет на непроверяемую фактуру) — не ослабляй его.
 *
 * ⚠️ Режем описание и комментарии по длине: описание у иных каналов — простыня из
 * ссылок на все соцсети, и она вытеснит из контекста сам вопрос. Берём начало (там
 * обещание ролика и тайм-коды) и пять самых залайканных комментариев.
 */
export function insightPromptBlock(i: VideoInsight): string {
  const ratio = viewsPerSub(i.views, i.subscribers);
  const desc = i.description.trim().slice(0, 900);
  const comments = i.topComments
    .slice(0, 5)
    .map((c) => `- «${c.text.replace(/\s+/g, " ").slice(0, 220)}» (${c.likes} лайков)`)
    .join("\n");

  return [
    `РЕФЕРЕНС — разбери его, прежде чем писать своё:`,
    `Название: ${i.title}`,
    `Канал: ${i.channelTitle} · ${i.subscribers.toLocaleString("ru-RU")} подписчиков`,
    `Собрал: ${i.views.toLocaleString("ru-RU")} просмотров (${formatRatio(ratio)} к подписчикам), ${i.likes.toLocaleString("ru-RU")} лайков, ${i.comments.toLocaleString("ru-RU")} комментариев`,
    desc ? `
Описание автора (часто там тайм-коды = структура ролика):
${desc}` : "",
    comments ? `
Что пишут в комментариях (по популярности):
${comments}` : "",
    `
Разбери: какой тут заход, на какую боль бьёт, что зацепило зрителей. Своё делай на той же механике, но НЕ копией.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface CompetitorFilters {
  minRatio: number;
  minViews: number;
  kind: CompetitorKind;
}

export function sanitizeFilters(v: unknown): CompetitorFilters {
  const o = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown, def: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : def;
  const kind = o.kind === "shorts" || o.kind === "long" ? o.kind : "all";
  return {
    minRatio: num(o.minRatio, DEFAULT_MIN_RATIO),
    minViews: num(o.minViews, DEFAULT_MIN_VIEWS),
    kind,
  };
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

// ── Русскоязычность выдачи ───────────────────────────────────────────────────

// ⚠️ Класс символов перечислен буквами, а НЕ через \p{Script=Cyrillic} с флагом `u`:
// текущий target сборки такие регулярки не принимает (те же грабли, что в words()).
const CYRILLIC_RE = /[а-яё]/i;

export function hasCyrillic(s: string): boolean {
  return CYRILLIC_RE.test(s);
}

/**
 * Русскоязычный ли ролик.
 *
 * ⚠️ `relevanceLanguage=ru&regionCode=RU` в поиске — это подсказка РАНЖИРОВАНИЯ, а не
 * фильтр: англоязычные ролики всё равно приезжают в выдаче, что и было видно на экране.
 * Настоящий фильтр возможен только по метаданным, и он двухступенчатый:
 *  1. язык дорожки/описания начинается на «ru» — берём сразу;
 *  2. языка нет или он чужой, но в названии ролика или канала есть кириллица — берём
 *     (русские авторы сплошь и рядом не заполняют язык либо ставят en по умолчанию).
 * Остальное — чужая ниша.
 *
 * ⚠️ Побочный эффект: русский ролик с полностью латинским названием («Toyota Camry
 * review») и без указанного языка отсеется. Это осознанный размен: пропустить пару
 * своих реже мешает, чем половина выдачи на английском.
 */
export function looksRussian(v: {
  title: string;
  channelTitle: string;
  language: string;
}): boolean {
  const lang = v.language.toLowerCase();
  if (lang.startsWith("ru")) return true;
  return hasCyrillic(v.title) || hasCyrillic(v.channelTitle);
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
 * Разбор строки в отдельные ключевые фразы.
 *
 * ⚠️ Нужно потому, что и ниша в брифе, и теги роликов сплошь и рядом заполнены
 * ПЕРЕЧИСЛЕНИЕМ в одном поле: «ремонт мерседес, обслуживание, диагностика». Без
 * разбивки такая строка приезжала в подсказки одним куском и уходила в поиск целиком —
 * запрос из трёх тем подряд не находит ничего.
 */
export function splitPhrases(raw: string): string[] {
  return raw
    .split(/[,;|\/\n]+/)
    .map(normalize)
    .filter(Boolean);
}

/**
 * Кандидаты в поисковые запросы: теги роликов канала + ниша из брифа.
 *
 * ⚠️ Порядок именно такой: СНАЧАЛА теги канала, ниша из брифа — в хвост. Теги — это
 * лексика ниши словами самого автора, ими он реально описывает свои ролики, и по ним
 * находится та же полка выдачи. Ниша из брифа написана для нас, человеком и на бегу
 * («бизнес-психология для предпринимателей») — как поисковый запрос она работает
 * хуже. Раньше она стояла первой и попадала в предвыбранные запросы, из-за чего
 * поиск шёл по формулировке из анкеты, а не по нише. Брифом пользуемся, когда канал
 * не подключён или тегов нет.
 *
 * Возвращаем кандидатов, ВЫБИРАЕТ человек: слепой автоподбор по 100 units за запрос —
 * плохая идея.
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

  // Частотность тегов: то, что автор ставит на каждый ролик, и есть ядро ниши.
  const freq = new Map<string, { text: string; n: number }>();
  for (const tag of input.tags) {
    for (const v of splitPhrases(tag)) {
      const key = v.toLowerCase();
      const w = words(v);
      if (w.length === 0 || w.length > 5) continue;
      if (w.every((x) => brandWords.has(x) || STOP_WORDS.has(x))) continue;
      const cur = freq.get(key);
      if (cur) cur.n += 1;
      else freq.set(key, { text: v, n: 1 });
    }
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

  // Ниша из брифа — в конец списка и тоже по частям.
  for (const v of splitPhrases(input.brief?.niche ?? "")) push(v.slice(0, 60));

  return out.slice(0, 14);
}

/** Нормализация списка запросов, пришедшего с клиента (он же — ключ кэша). */
export function sanitizeQueries(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    // Перечисление через запятую в одном поле раскладываем на отдельные запросы:
    // иначе в поиск уедет строка из трёх тем сразу и не найдёт ничего.
    for (const phrase of splitPhrases(String(raw ?? ""))) {
      const v = phrase.slice(0, 80);
      const key = v.toLowerCase();
      if (v.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= COMPETITOR_MAX_QUERIES) return out;
    }
  }
  return out;
}
