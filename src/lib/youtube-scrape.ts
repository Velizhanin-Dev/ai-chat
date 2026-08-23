// ── Публичные данные YouTube мимо Data API (0 units квоты) ───────────────────
//
// Зачем: три вещи, на которых живут vidIQ и TubeBuddy, официальный API либо не
// отдаёт, либо отдаёт за огромные деньги:
//  1. ТЕГИ чужого ролика — с 2021 в `videos.list` их видит только владелец, а на
//     странице ролика они лежат открытым текстом (проверено);
//  2. КОНКУРЕНЦИЯ по запросу (сколько всего роликов) — в API это `search.list`
//     за 100 units из 10 000 суточных, на странице выдачи — бесплатно;
//  3. ПОДСКАЗКИ поиска (что люди реально дописывают) — в API их нет вообще.
//
// ⚠️⚠️ Это НЕофициальный путь: разметка страниц не документирована и может
// поменяться в любой день, а частые запросы с одного адреса ловят капчу. Поэтому:
//  • любой сбой здесь — ШТАТНОЕ «данных нет», а не ошибка (как с расшифровками);
//  • результаты кэшируем и не ходим за одним и тем же дважды;
//  • там, где есть API-путь (поиск роликов), он остаётся источником правды, а это —
//    дополнением; ломается разметка — фича молча выключается, раздел работает.
//
// ⚠️ Ходим через ТОТ ЖЕ зарубежный микросервис, что и за расшифровками
// (scripts/setup-transcript-service.sh): прод стоит в РФ, и ему в YouTube лучше не
// ходить вовсе. Переменная не задана — идём напрямую (годится для разработки).

// Базовый адрес сервиса: `https://<домен>/yt`. Отдельная переменная, но если её
// нет — выводим из адреса расшифровок (там полный путь `…/yt/transcript`), чтобы
// не заводить на проде вторую переменную ради того же сервера.
const SERVICE_BASE = (() => {
  const explicit = (process.env.YT_SCRAPE_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  const transcript = (process.env.YT_TRANSCRIPT_URL || "").replace(/\/$/, "");
  return transcript ? transcript.replace(/\/[^/]*$/, "") : "";
})();
const SERVICE_TOKEN = process.env.YT_TRANSCRIPT_TOKEN || "";
const TIMEOUT_MS = Math.max(5_000, Number(process.env.YT_SCRAPE_TIMEOUT_MS ?? 20_000));

// Локаль запроса: русская выдача и русские подсказки. ⚠️ Без неё язык определяется
// по IP сервера — с зарубежного VPS приезжает немецкая или английская страница
// (ловили на пробе: «293.164 Aufrufe», «vor 2 Jahren»).
const LOCALE = "hl=ru&gl=RU";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Кэш в памяти ─────────────────────────────────────────────────────────────
// Теги вышедшего ролика не меняются, подсказки и объём выдачи меняются медленно —
// а каждый поход это внешний запрос на полтора мегабайта. Память, а не БД: данные
// публичные и дешёво добываются заново.
const TAGS_TTL_MS = 24 * 60 * 60 * 1000;
const QUERY_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; data: unknown }>();

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > hit.ttl) return null;
  return hit.data as T;
}
function putCache(key: string, data: unknown, ttl: number) {
  // Потолок на всякий случай: словарь не должен расти бесконечно на длинной сессии.
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), ttl, data });
}

// ── Загрузка страницы ────────────────────────────────────────────────────────
//
// Через сервис — `GET {base}/page?url=…`, он отдаёт `{ html }`. Напрямую (без
// сервиса) — обычный fetch. Возвращает null на любой сбой: «нет данных» здесь
// штатно.
async function loadPage(url: string, maxBytes: number): Promise<string | null> {
  try {
    if (SERVICE_BASE) {
      const res = await fetch(
        `${SERVICE_BASE}/page?url=${encodeURIComponent(url)}&limit=${maxBytes}`,
        {
          headers: SERVICE_TOKEN ? { "X-Token": SERVICE_TOKEN } : {},
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { html?: string };
      return data.html || null;
    }
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ru,en;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Подсказки поиска (спрос) ─────────────────────────────────────────────────

/** Разбор ответа автодополнения: `["запрос",["подсказка",…],…]`. */
export function parseSuggest(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return [];
    return (parsed[1] as unknown[])
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Что люди дописывают к запросу в поиске YouTube.
 *
 * ⚠️ Это ЕДИНСТВЕННЫЙ доступный нам сигнал спроса, и он качественный, а не
 * количественный: сколько раз в месяц ищут — YouTube не говорит НИКОМУ (цифры
 * vidIQ — их собственная оценка). Поэтому наружу отдаём порядок подсказок как
 * есть и нигде не выдаём его за «объём поиска».
 */
export async function fetchSuggestions(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const key = `sg:${q}`;
  const hit = cached<string[]>(key);
  if (hit) return hit;

  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&${LOCALE}&q=${encodeURIComponent(q)}`;
  let raw: string | null = null;
  try {
    if (SERVICE_BASE) {
      const res = await fetch(`${SERVICE_BASE}/suggest?q=${encodeURIComponent(q)}`, {
        headers: SERVICE_TOKEN ? { "X-Token": SERVICE_TOKEN } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { raw?: string };
        raw = data.raw ?? null;
      }
    } else {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) raw = await res.text();
    }
  } catch {
    raw = null;
  }
  if (!raw) return [];

  const list = parseSuggest(raw).slice(0, 20);
  putCache(key, list, QUERY_TTL_MS);
  return list;
}

// ── Теги ролика ──────────────────────────────────────────────────────────────

export interface ScrapedVideoTags {
  tags: string[];
  title: string;
  channelTitle: string;
}

/**
 * Теги со страницы ролика.
 *
 * ⚠️ Берём из ДВУХ мест: `ytInitialPlayerResponse.videoDetails.keywords` (массив,
 * чистый) и `<meta name="keywords">` (строка через запятую) — второе как запасной
 * путь, потому что структура плеерного JSON меняется чаще, чем meta-тег в head.
 */
export function parseVideoTags(html: string): ScrapedVideoTags {
  const out: ScrapedVideoTags = { tags: [], title: "", channelTitle: "" };

  // ⚠️ Без флага /s: текущий target сборки его не принимает (те же грабли, что с
  // \p{…}/u в competitors.ts). Вместо точки — явный [\s\S].
  const player = /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (player) {
    try {
      const data = JSON.parse(player[1]) as {
        videoDetails?: { keywords?: unknown; title?: unknown; author?: unknown };
      };
      const vd = data.videoDetails;
      if (Array.isArray(vd?.keywords)) {
        out.tags = vd.keywords.filter((t): t is string => typeof t === "string");
      }
      if (typeof vd?.title === "string") out.title = vd.title;
      if (typeof vd?.author === "string") out.channelTitle = vd.author;
    } catch {
      /* разметка поменялась — падаем на meta ниже */
    }
  }

  if (out.tags.length === 0) {
    const meta = /<meta name="keywords" content="([^"]*)"/.exec(html);
    if (meta) {
      out.tags = meta[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  // Дедупликация без учёта регистра: авторы часто дублируют «ремонт» и «Ремонт».
  const seen = new Set<string>();
  out.tags = out.tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}

/** Теги чужого ролика. null — не достали (разметка/сеть); это штатно. */
export async function fetchVideoTags(videoId: string): Promise<ScrapedVideoTags | null> {
  if (!/^[\w-]{6,20}$/.test(videoId)) return null;
  const key = `tg:${videoId}`;
  const hit = cached<ScrapedVideoTags>(key);
  if (hit) return hit;

  // ⚠️⚠️ Тянем страницу ЦЕЛИКОМ, и это не расточительность. Первая версия грузила
  // 512 КБ «потому что теги в head» — и всегда возвращала пусто: замерено на живой
  // странице, `<meta name="keywords">` лежит на отметке ~676 КБ, а
  // `ytInitialPlayerResponse` — на ~685 КБ (в начале документа только скрипты
  // плеера). Урезать лимит можно, только если сначала померить заново.
  const html = await loadPage(
    `https://www.youtube.com/watch?v=${videoId}&${LOCALE}`,
    3 * 1024 * 1024
  );
  if (!html) return null;

  const parsed = parseVideoTags(html);
  if (!parsed.tags.length && !parsed.title) return null;
  putCache(key, parsed, TAGS_TTL_MS);
  return parsed;
}

// ── Выдача по запросу (конкуренция + кто ранжируется) ────────────────────────

export interface SearchTopVideo {
  id: string;
  title: string;
  channelTitle: string;
  views: number;
  duration: string;
  publishedText: string;
}

export interface ScrapedSearch {
  /** Сколько всего роликов YouTube нашёл по запросу — прокси конкуренции. */
  totalResults: number;
  top: SearchTopVideo[];
}

/**
 * Число из локализованного текста вроде «293.164 Aufrufe», «1,2 млн просмотров»,
 * «293K views».
 *
 * ⚠️ Локаль зависит от IP сервера, поэтому разделители разрядов могут быть любыми,
 * а сокращения — русскими, английскими и немецкими. Полное число (только цифры и
 * разделители) читаем как есть; сокращение — умножаем на порядок.
 */
export function parseCount(text: string): number {
  const t = text.toLowerCase().replace(/ /g, " ");
  const num = /([\d.,\s]+)\s*([a-zа-яё.]*)/.exec(t);
  if (!num) return 0;

  const suffix = num[2] ?? "";
  const mult = /^(тыс|k|т)/.test(suffix)
    ? 1_000
    : /^(млн|m|mio)/.test(suffix)
      ? 1_000_000
      : /^(млрд|b|mrd)/.test(suffix)
        ? 1_000_000_000
        : 1;

  const raw = num[1].trim();
  if (mult > 1) {
    // «1,2 млн» / «1.2M» — дробная часть значима, разделитель локальный.
    const normalized = raw.replace(/\s/g, "").replace(",", ".");
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? Math.round(value * mult) : 0;
  }
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function firstText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const o = node as { simpleText?: unknown; runs?: unknown };
  if (typeof o.simpleText === "string") return o.simpleText;
  if (Array.isArray(o.runs)) {
    return o.runs
      .map((r) => (r && typeof r === "object" ? String((r as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

/** Разбор страницы выдачи: общее число результатов + карточки роликов. */
export function parseSearchHtml(html: string): ScrapedSearch {
  const out: ScrapedSearch = { totalResults: 0, top: [] };

  const data = /ytInitialData\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (!data) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data[1]);
  } catch {
    return out;
  }

  const root = parsed as { estimatedResults?: unknown };
  if (typeof root.estimatedResults === "string") {
    out.totalResults = Number(root.estimatedResults.replace(/\D/g, "")) || 0;
  }

  // Карточки лежат глубоко и на разной глубине (реклама, полки, «люди также
  // смотрят»), поэтому обходим дерево и собираем все videoRenderer подряд.
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 30 || found.length > 40) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const renderer = obj.videoRenderer;
    if (renderer && typeof renderer === "object") {
      found.push(renderer as Record<string, unknown>);
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(parsed, 0);

  out.top = found
    .map((v) => ({
      id: typeof v.videoId === "string" ? v.videoId : "",
      title: firstText(v.title),
      channelTitle: firstText(v.ownerText) || firstText(v.longBylineText),
      views: parseCount(firstText(v.viewCountText) || firstText(v.shortViewCountText)),
      duration: firstText(v.lengthText),
      publishedText: firstText(v.publishedTimeText),
    }))
    .filter((v) => v.id && v.title);

  return out;
}

/** Выдача по запросу. null — не достали (штатно). */
export async function fetchSearchStats(query: string): Promise<ScrapedSearch | null> {
  const q = query.trim().slice(0, 120);
  if (!q) return null;
  const key = `sr:${q}`;
  const hit = cached<ScrapedSearch>(key);
  if (hit) return hit;

  const html = await loadPage(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&${LOCALE}`,
    3 * 1024 * 1024
  );
  if (!html) return null;

  const parsed = parseSearchHtml(html);
  if (!parsed.totalResults && parsed.top.length === 0) return null;
  putCache(key, parsed, QUERY_TTL_MS);
  return parsed;
}

// ── Страница выдачи как источник id (замена search.list за 100 units) ────────

export interface ScrapedSearchPage {
  ids: string[];
  totalResults: number;
  /** Токен продолжения (innertube) — по нему берётся следующая порция. */
  continuation: string | null;
  /** Ключ и версия клиента со страницы: нужны, чтобы продолжение вообще приняли. */
  apiKey: string | null;
  clientVersion: string | null;
}

/**
 * Первая страница выдачи БЕЗ Data API.
 *
 * ⚠️ Ради этого всё и затевалось: `search.list` стоит 100 units из 10 000 суточных,
 * то есть сто поисков в день на весь продукт. Страница отдаёт те же id бесплатно,
 * а метаданные (просмотры, длительность, канал) мы и так добираем отдельным
 * `videos.list` за 1 unit на полсотни роликов.
 *
 * ⚠️ На странице ~15–20 роликов против 50 у API — это цена бесплатности. Дальше
 * листаем продолжениями (см. fetchSearchContinuation), они тоже бесплатны.
 */
export async function fetchSearchPage(
  query: string,
  opts: {
    order?: "viewCount" | "relevance" | "date";
    /** Окно в днях; 0/null — за всё время. Уходит в фильтр страницы (см. buildSp). */
    periodDays?: number | null;
  } = {}
): Promise<ScrapedSearchPage | null> {
  const q = query.trim().slice(0, 120);
  if (!q) return null;

  const sp = buildSp(opts.order, opts.periodDays ?? null);
  const url =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&${LOCALE}` +
    (sp ? `&sp=${sp}` : "");

  const html = await loadPage(url, 3 * 1024 * 1024);
  if (!html) return null;

  const parsed = parseSearchHtml(html);
  const ids = parsed.top.map((v) => v.id).filter(Boolean);
  if (ids.length === 0) return null;

  return {
    ids,
    totalResults: parsed.totalResults,
    continuation: matchOne(html, /"continuationCommand":\{"token":"([^"]{20,})"/),
    apiKey: matchOne(html, /"INNERTUBE_API_KEY":"([^"]+)"/),
    clientVersion: matchOne(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/),
  };
}

/**
 * Параметр `sp` — фильтры страницы выдачи (сортировка + период + тип).
 *
 * ⚠️⚠️ ПЕРИОД ОБЯЗАТЕЛЕН, если он задан. На этом уже обожглись: сортировка «по
 * просмотрам» БЕЗ фильтра даты возвращает всевременной топ, и по широкому запросу
 * («майнкрафт») в выдаче не оказалось НИ ОДНОГО ролика свежее 90 дней — самому
 * молодому было 222 дня. Раздел показывал ноль, хотя свежие ролики в нише есть.
 * Проверено живьём: с фильтром «за месяц» по тому же запросу приезжают ролики
 * возрастом 10–20 дней.
 *
 * Формат — protobuf в base64url: поле 1 — сортировка (2 = по дате, 3 = по
 * просмотрам; для релевантности поле не ставится вовсе), поле 2 — вложенные фильтры
 * { поле 1 — период загрузки, поле 2 — тип «видео» }.
 */
function buildSp(order: string | undefined, periodDays: number | null): string {
  const sort = order === "viewCount" ? 3 : order === "date" ? 2 : 0;

  // Периоды страницы грубее наших: неделя / месяц / год. Берём ближайший СВЕРХУ —
  // лишнее отсечём по точной дате уже у себя (см. collectPage), а вот недобрать
  // свежее нельзя: именно это и ломало выдачу.
  const upload =
    periodDays == null || periodDays <= 0
      ? 0
      : periodDays <= 7
        ? 3
        : periodDays <= 31
          ? 4
          : 5;

  const filters: number[] = [];
  if (upload) filters.push(0x08, upload);
  filters.push(0x10, 0x01); // тип: видео

  const bytes: number[] = [];
  if (sort) bytes.push(0x08, sort);
  bytes.push(0x12, filters.length, ...filters);

  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function matchOne(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[1] : null;
}

/**
 * Следующая порция выдачи по токену продолжения — тем же путём, каким листает сам
 * сайт. Тоже 0 units.
 *
 * ⚠️ Идёт POST-ом на внутренний эндпоинт плеера, а не на Data API: у публичной
 * страницы своего «page 2» нет вовсе, всё подгружается этим вызовом.
 */
export async function fetchSearchContinuation(page: {
  apiKey: string | null;
  clientVersion: string | null;
  continuation: string | null;
}): Promise<{ ids: string[]; continuation: string | null } | null> {
  if (!page.apiKey || !page.continuation) return null;

  const body = JSON.stringify({
    context: {
      client: {
        clientName: "WEB",
        clientVersion: page.clientVersion || "2.20240101.00.00",
        hl: "ru",
        gl: "RU",
      },
    },
    continuation: page.continuation,
  });

  try {
    const target = `https://www.youtube.com/youtubei/v1/search?key=${page.apiKey}&prettyPrint=false`;
    let text: string | null = null;

    if (SERVICE_BASE) {
      const res = await fetch(`${SERVICE_BASE}/post?url=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SERVICE_TOKEN ? { "X-Token": SERVICE_TOKEN } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { body?: string };
        text = data.body || null;
      }
    } else {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) text = await res.text();
    }
    if (!text) return null;

    const parsed = parseSearchHtml(`ytInitialData = ${text};`);
    const ids = parsed.top.map((v) => v.id).filter(Boolean);
    if (ids.length === 0) return null;

    return { ids, continuation: matchOne(text, /"token":"([^"]{20,})"/) };
  } catch {
    return null;
  }
}

/** Доступен ли путь вообще (для UI: показывать ли инструмент). */
export function scrapeConfigured(): boolean {
  // Без сервиса ходим напрямую — на локальной разработке это работает, на проде
  // (РФ) почти наверняка нет. Отдельного рубильника не заводим: сбой и так штатен.
  return true;
}
