import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sanitizeBrief, type Brief } from "./brief";
import {
  getValidAccessToken,
  fetchChannelInfo,
  fetchRecentVideos,
} from "./youtube";
import {
  searchVideoPage,
  fetchVideosByIds,
  fetchChannelsByIds,
  fetchFeaturedChannels,
  fetchChannelUploads,
  fetchTopComments,
  resolveChannel,
  type PublicChannel,
  type SearchOrder,
} from "./youtube-search";
import {
  hasYoutubeKeys,
  keyPoolStatus,
  NoKeysError,
  QuotaExhaustedError,
  type KeyPoolStatus,
} from "./youtube-keys";
import {
  COMPETITOR_MAX_AUTO_PAGES,
  COMPETITOR_SEARCH_COST,
  COMPETITOR_TARGET_RESULTS,
  aggregateChannels,
  applyFilters,
  SHORT_MAX_SECONDS,
  isoSeconds,
  looksRussian,
  suggestQueries,
  viewsPerSub,
  type CompetitorChannel,
  type CompetitorFilters,
  type NicheChannelsResult,
  type VideoInsight,
  type TrackedChannelRow,
  type TrackedFeedResult,
  type CompetitorOrder,
  type CompetitorResult,
  type CompetitorVideo,
} from "./competitors";

// ── Конкуренты в нише: сбор выдачи ───────────────────────────────────────────
// Ищем ролики по нише и считаем «просмотры / подписчики»: чем выше, тем сильнее
// ролик вылетел за пределы своей аудитории — то есть сработала упаковка, а не
// накопленная база канала. Именно такие ролики стоит разбирать.
//
// ⚠️ Дорого: один поисковый запрос = 100 units квоты (обычный вызов = 1). Поэтому
// поиск идёт по пулу ключей с ротацией (youtube-keys.ts), запускается только по
// кнопке и кэшируется на 6 часов. Фильтры (порог соотношения, минимум просмотров,
// шортсы/лонги) применяются НА КЛИЕНТЕ — крутить их можно бесплатно.

const RESULT_TTL_MS = 6 * 60 * 60 * 1000;
const CONTEXT_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Запуск поиска: накопленный результат + место, на котором остановились по каждому
// запросу. Токены нужны для кнопки «Показать ещё»: YouTube отдаёт следующую страницу
// только по своему pageToken, у каждого запроса он свой.
interface CachedRun {
  at: number;
  data: CompetitorResult;
  tokens: Record<string, string | null>;
  /** Все id, что уже проходили через выдачу, — чтобы не разбирать их повторно. */
  seen: Set<string>;
}

// Память — быстрый путь; источник правды — таблица CompetitorSearch (переживает
// перезапуск, см. loadRun/saveRun ниже).
const resultCache = new Map<string, CachedRun>();

/**
 * Достать сохранённый запуск: сперва из памяти, иначе из БД.
 *
 * ⚠️ Ради этого и заведена таблица: без неё после каждого деплоя повтор того же
 * самого поиска шёл в YouTube заново по 100 units за запрос, хотя человек ничего
 * не менял. Теперь платим только за реально новый поиск.
 */
async function loadRun(conversationId: string, key: string): Promise<CachedRun | null> {
  const hit = resultCache.get(key);
  if (hit) return hit;
  try {
    const row = await prisma.competitorSearch.findUnique({
      where: { conversationId_key: { conversationId, key } },
    });
    if (!row) return null;
    const run: CachedRun = {
      at: row.updatedAt.getTime(),
      data: row.result as unknown as CompetitorResult,
      tokens: (row.tokens ?? {}) as Record<string, string | null>,
      seen: new Set(row.seen),
    };
    resultCache.set(key, run);
    return run;
  } catch (err) {
    // Кэш — не критичный путь: не смогли прочитать, значит ищем заново.
    console.error("[competitors] чтение сохранённой выдачи:", err);
    return null;
  }
}

async function saveRun(conversationId: string, key: string, run: CachedRun): Promise<void> {
  resultCache.set(key, run);
  const payload = {
    result: run.data as unknown as Prisma.InputJsonValue,
    tokens: run.tokens as unknown as Prisma.InputJsonValue,
    seen: Array.from(run.seen),
  };
  try {
    await prisma.competitorSearch.upsert({
      where: { conversationId_key: { conversationId, key } },
      create: { conversationId, key, ...payload },
      update: payload,
    });
  } catch (err) {
    // Не сохранилось — выдача всё равно уже у человека на экране.
    console.error("[competitors] сохранение выдачи:", err);
  }
}
const contextCache = new Map<string, { at: number; data: ChannelHint }>();

interface ChannelHint {
  channelId: string | null;
  channelTitle: string;
  tags: string[];
}

function resultKey(
  conversationId: string,
  queries: string[],
  periodDays: number,
  order: CompetitorOrder
): string {
  return `${conversationId}|${queries.join("|").toLowerCase()}|${periodDays}|${order}`;
}

async function projectBrief(conversationId: string): Promise<Brief | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { brief: true },
  });
  return conv?.brief ? sanitizeBrief(conv.brief) : null;
}

/**
 * Подсказки из подключённого канала: название (чтобы не искать сам себя) и теги
 * последних роликов — это готовые поисковые фразы словами автора.
 *
 * Стоит 3 units на НАШЕМ проекте (канал + плейлист + видео), поэтому кэш на 30 мин.
 * Канал не подключён или сбой — работаем на одном брифе, раздел не падает.
 */
async function channelHint(conversationId: string): Promise<ChannelHint> {
  const cached = contextCache.get(conversationId);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.data;

  const empty: ChannelHint = { channelId: null, channelTitle: "", tags: [] };
  const integ = await prisma.youTubeIntegration.findUnique({ where: { conversationId } });
  if (!integ) return empty;

  try {
    const token = await getValidAccessToken(integ);
    const info = await fetchChannelInfo(token);
    if (!info) return empty;
    // 50 роликов, а не 20: подсказки строятся на ЧАСТОТНОСТИ тегов, и чем шире
    // выборка, тем честнее выходит ядро ниши. Цена та же — страница playlistItems
    // до 50 штук стоит 1 unit.
    const page = info.uploadsPlaylistId
      ? await fetchRecentVideos(token, info.uploadsPlaylistId, 50)
      : { videos: [], nextPageToken: null };
    const tags = page.videos.flatMap((v) => v.tags ?? []);
    const data: ChannelHint = {
      channelId: info.channelId,
      channelTitle: info.title,
      tags,
    };
    contextCache.set(conversationId, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.warn("[competitors] не удалось взять подсказки с канала:", err);
    return empty;
  }
}

export interface CompetitorContext {
  /** Настроены ли ключи поиска — без них раздел работать не может. */
  configured: boolean;
  channelConnected: boolean;
  channelTitle: string;
  /** Кандидаты в поисковые запросы: ниша из брифа + частые теги роликов. */
  suggested: string[];
  quota: KeyPoolStatus;
  searchCost: number;
  /** Включены ли уведомления «у конкурента залетело» для этого проекта. */
  alerts: boolean;
  /** Привязан ли телеграм у владельца проекта (иначе слать некуда). */
  telegramLinked: boolean;
}

export async function getCompetitorContext(
  conversationId: string
): Promise<CompetitorContext> {
  const [brief, hint, conv] = await Promise.all([
    projectBrief(conversationId),
    channelHint(conversationId),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { competitorAlerts: true, user: { select: { telegramChatId: true } } },
    }),
  ]);
  return {
    // Уведомления шлём в личку владельца проекта, поэтому вместе с флагом отдаём
    // и то, привязан ли телеграм: без привязки тумблер включать бессмысленно.
    alerts: Boolean(conv?.competitorAlerts),
    telegramLinked: Boolean(conv?.user?.telegramChatId),
    configured: hasYoutubeKeys(),
    channelConnected: Boolean(hint.channelId),
    channelTitle: hint.channelTitle,
    suggested: suggestQueries({
      brief,
      tags: hint.tags,
      channelTitle: hint.channelTitle,
    }),
    quota: keyPoolStatus(),
    searchCost: COMPETITOR_SEARCH_COST,
  };
}

export type CompetitorOutcome =
  | { status: "ok"; result: CompetitorResult; cached: boolean }
  | { status: "no_keys" }
  | { status: "quota" }
  | { status: "error"; message: string };

/**
 * Одна страница выдачи по каждому запросу: ищем → добираем метаданные → считаем
 * соотношение. `tokens` — где остановились в прошлый раз (пусто = первая страница);
 * запросы с `null` уже вычерпаны и в API не идут, за них не платим.
 */
async function collectPage(
  hint: ChannelHint,
  queries: string[],
  opts: { order: CompetitorOrder; publishedAfter: string | null },
  tokens: Record<string, string | null>,
  seen: Set<string>
): Promise<{
  rows: CompetitorVideo[];
  tokens: Record<string, string | null>;
  scanned: number;
  hiddenSubs: number;
  foreign: number;
}> {
  // Один ролик может найтись по нескольким запросам — запоминаем первый,
  // чтобы потом было видно, какое ключевое слово реально приносит выдачу.
  const foundBy = new Map<string, string>();
  const nextTokens: Record<string, string | null> = { ...tokens };

  for (const q of queries) {
    const first = !(q in tokens);
    const token = tokens[q];
    // Продолжать нечего: у этого запроса выдача кончилась.
    if (!first && !token) continue;

    const page = await searchVideoPage({
      q,
      order: opts.order,
      publishedAfter: opts.publishedAfter,
      pageToken: token,
    });
    nextTokens[q] = page.nextPageToken;
    for (const id of page.ids) {
      // Уже разбирали на прошлых страницах — второй раз не платим за метаданные.
      if (seen.has(id) || foundBy.has(id)) continue;
      foundBy.set(id, q);
    }
  }

  const ids = Array.from(foundBy.keys());
  const videos = ids.length ? await fetchVideosByIds(ids) : [];

  const channelIds = Array.from(new Set(videos.map((v) => v.channelId).filter(Boolean)));
  const channels = channelIds.length
    ? await fetchChannelsByIds(channelIds)
    : new Map<string, PublicChannel>();

  let hiddenSubs = 0;
  let foreign = 0;
  const rows: CompetitorVideo[] = [];
  {
    for (const v of videos) {
      // Свой канал в конкурентах не показываем.
      if (hint.channelId && v.channelId === hint.channelId) continue;
      const ch = channels.get(v.channelId);
      if (!ch) continue;
      // Работаем только по русскоязычной нише: relevanceLanguage в поиске лишь
      // ранжирует, поэтому чужую выдачу отсекаем здесь, по метаданным ролика.
      if (!looksRussian({ title: v.title, channelTitle: ch.title || v.channelTitle, language: v.language })) {
        foreign += 1;
        continue;
      }
      // Скрытый счётчик подписчиков — соотношение посчитать не из чего.
      if (ch.hiddenSubscribers) {
        hiddenSubs += 1;
        continue;
      }
      const sec = isoSeconds(v.duration);
      rows.push({
        id: v.id,
        title: v.title,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
        duration: v.duration,
        isShort: sec > 0 && sec <= SHORT_MAX_SECONDS,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        channelId: v.channelId,
        channelTitle: ch.title || v.channelTitle,
        channelThumb: ch.thumbnail,
        channelUrl: ch.customUrl
          ? `https://www.youtube.com/${ch.customUrl}`
          : `https://www.youtube.com/channel/${v.channelId}`,
        subscribers: ch.subscribers,
        ratio: viewsPerSub(v.views, ch.subscribers),
        query: foundBy.get(v.id) ?? "",
      });
    }
  }

  for (const id of ids) seen.add(id);
  return { rows, tokens: nextTokens, scanned: videos.length, hiddenSubs, foreign };
}

/** Во сколько units обойдётся следующая страница: платим только за живые запросы. */
function nextPageCost(tokens: Record<string, string | null>): number {
  return Object.values(tokens).filter(Boolean).length * COMPETITOR_SEARCH_COST;
}

/**
 * Первый поиск (кнопка «Найти») — одна страница на запрос.
 *
 * Кнопки «Обновить» нет: решение «искать заново или отдать из памяти» принимает
 * сервер. Те же запросы с теми же параметрами в пределах TTL — из кэша (квота цела),
 * любое изменение параметров даёт другой ключ и живой поиск.
 */
export async function runCompetitorSearch(
  conversationId: string,
  opts: {
    queries: string[];
    periodDays: number;
    order: CompetitorOrder;
    /** Фильтры экрана: по ним считается, набралось ли уже COMPETITOR_TARGET_RESULTS. */
    filters: CompetitorFilters;
  }
): Promise<CompetitorOutcome> {
  const { queries, periodDays, order, filters } = opts;
  if (queries.length === 0) return { status: "error", message: "Не задан ни один запрос" };
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const key = resultKey(conversationId, queries, periodDays, order);
  const cached = await loadRun(conversationId, key);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) {
    return { status: "ok", result: cached.data, cached: true };
  }

  const hint = await channelHint(conversationId);
  const publishedAfter =
    periodDays > 0 ? new Date(Date.now() - periodDays * DAY_MS).toISOString() : null;

  try {
    const seen = new Set<string>();
    const filled = await fillPages(
      hint,
      queries,
      { order, publishedAfter },
      {},
      seen,
      [],
      filters
    );

    const result: CompetitorResult = {
      queries,
      periodDays,
      order,
      pagesLoaded: filled.pages,
      hasMore: nextPageCost(filled.tokens) > 0,
      nextCost: nextPageCost(filled.tokens),
      fetchedAt: new Date().toISOString(),
      scanned: filled.scanned,
      hiddenSubs: filled.hiddenSubs,
      foreign: filled.foreign,
      videos: filled.rows,
    };
    await saveRun(conversationId, key, {
      at: Date.now(),
      data: result,
      tokens: filled.tokens,
      seen,
    });
    return { status: "ok", result, cached: false };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Листаем выдачу, пока подходящих (прошедших фильтры экрана) роликов не станет
 * COMPETITOR_TARGET_RESULTS — или пока не кончатся страницы / не упрёмся в потолок
 * COMPETITOR_MAX_AUTO_PAGES.
 *
 * ⚠️ Считаем ОТФИЛЬТРОВАННЫЕ, а не сырые: сырых с первой же страницы приезжает
 * полсотни, но после порога «просмотров кратно больше, чем подписчиков» остаются
 * единицы — ровно на это и жаловались («страница выглядит пустой»).
 * ⚠️ Потолок страниц обязателен: в узкой нише двадцати таких роликов может не быть
 * вовсе, и цикл без ограничения вычерпал бы всю выдачу за 100 units на страницу
 * на каждый запрос.
 */
async function fillPages(
  hint: ChannelHint,
  queries: string[],
  opts: { order: SearchOrder; publishedAfter: string | null },
  tokens: Record<string, string | null>,
  seen: Set<string>,
  known: CompetitorVideo[],
  filters: CompetitorFilters,
  target = COMPETITOR_TARGET_RESULTS,
  maxPages = COMPETITOR_MAX_AUTO_PAGES
): Promise<{
  rows: CompetitorVideo[];
  tokens: Record<string, string | null>;
  pages: number;
  scanned: number;
  hiddenSubs: number;
  foreign: number;
}> {
  let rows = [...known];
  let cur = tokens;
  let pages = 0;
  let scanned = 0;
  let hiddenSubs = 0;
  let foreign = 0;

  while (pages < maxPages) {
    const page = await collectPage(hint, queries, opts, cur, seen);
    pages += 1;
    cur = page.tokens;
    scanned += page.scanned;
    hiddenSubs += page.hiddenSubs;
    foreign += page.foreign;
    rows = [...rows, ...page.rows];
    // Страниц больше нет ни по одному запросу — дальше листать нечего.
    if (nextPageCost(cur) === 0) break;
    if (applyFilters(rows, filters).length >= target) break;
  }

  return {
    rows: rows.sort((a, b) => b.ratio - a.ratio),
    tokens: cur,
    pages,
    scanned,
    hiddenSubs,
    foreign,
  };
}

/**
 * «Показать ещё»: следующая страница выдачи, доклеенная к уже найденному.
 *
 * ⚠️ Продолжать можно только от сохранённых pageToken — своего «смещения» у
 * search.list нет. Токены живут в кэше запуска, поэтому если он протух (6 часов)
 * или сервер перезапустили, честно отвечаем `expired`, а не ищем молча заново:
 * повторный поиск с нуля стоит тех же денег, и решать должен человек.
 */
export async function loadMoreCompetitors(
  conversationId: string,
  opts: {
    queries: string[];
    periodDays: number;
    order: CompetitorOrder;
    filters: CompetitorFilters;
  }
): Promise<CompetitorOutcome | { status: "expired" }> {
  const { queries, periodDays, order, filters } = opts;
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const key = resultKey(conversationId, queries, periodDays, order);
  const run = await loadRun(conversationId, key);
  if (!run || Date.now() - run.at >= RESULT_TTL_MS) return { status: "expired" };
  if (nextPageCost(run.tokens) === 0) {
    return { status: "ok", result: run.data, cached: true };
  }

  const hint = await channelHint(conversationId);
  const publishedAfter =
    periodDays > 0 ? new Date(Date.now() - periodDays * DAY_MS).toISOString() : null;

  try {
    // «Показать ещё» добирает не ровно страницу, а до +COMPETITOR_TARGET_RESULTS
    // подходящих сверх того, что уже показано (тот же потолок страниц).
    const have = applyFilters(run.data.videos, filters).length;
    const filled = await fillPages(
      hint,
      queries,
      { order, publishedAfter },
      run.tokens,
      run.seen,
      run.data.videos,
      filters,
      have + COMPETITOR_TARGET_RESULTS
    );

    const result: CompetitorResult = {
      ...run.data,
      pagesLoaded: run.data.pagesLoaded + filled.pages,
      hasMore: nextPageCost(filled.tokens) > 0,
      nextCost: nextPageCost(filled.tokens),
      fetchedAt: new Date().toISOString(),
      scanned: run.data.scanned + filled.scanned,
      hiddenSubs: run.data.hiddenSubs + filled.hiddenSubs,
      foreign: run.data.foreign + filled.foreign,
      videos: filled.rows,
    };
    await saveRun(conversationId, key, {
      at: Date.now(),
      data: result,
      tokens: filled.tokens,
      seen: run.seen,
    });
    return { status: "ok", result, cached: false };
  } catch (err) {
    return failure(err);
  }
}

function failure(err: unknown): CompetitorOutcome {
  if (err instanceof QuotaExhaustedError) return { status: "quota" };
  if (err instanceof NoKeysError) return { status: "no_keys" };
  console.error("[competitors] поиск не удался:", err);
  return { status: "error", message: "Не удалось получить выдачу YouTube" };
}

export function normalizeOrder(v: unknown): SearchOrder {
  return v === "relevance" || v === "date" ? v : "viewCount";
}

export function normalizePeriod(v: unknown): number {
  const n = Number(v);
  return n === 0 || n === 30 || n === 90 || n === 365 ? n : 90;
}


// ── Конкуренты-КАНАЛЫ ────────────────────────────────────────────────────────
//
// ⚠️ «Похожих каналов» YouTube Data API не отдаёт (related-channels выпилены,
// search.list?type=channel матчит только название/описание и стоит 100 units).
// Поэтому собираем из двух дешёвых сигналов: агрегация УЖЕ найденной выдачи
// роликов (0 дополнительных units) + «рекомендованные каналы» самих этих каналов
// (channelSections, 1 unit на канал — то, что автор руками поставил себе на
// страницу; коллеги по нише там точнее любого текстового поиска).
//
// ⚠️ Своего поиска этот режим НЕ запускает: работает поверх результата в кэше.
// Нет кэша (протух / не искали) — просим нажать «Найти», а не тратим 100 units
// на запрос молча.

/** Сколько каналов выдачи расспрашиваем про «рекомендованных» (1 unit за каждый). */
const FEATURED_SEED_LIMIT = 12;

export async function findNicheChannels(
  conversationId: string,
  opts: {
    queries: string[];
    periodDays: number;
    order: CompetitorOrder;
    filters: CompetitorFilters;
  }
): Promise<
  | { status: "ok"; result: NicheChannelsResult }
  | { status: "expired" }
  | { status: "no_keys" }
  | { status: "quota" }
  | { status: "error"; message: string }
> {
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const key = resultKey(conversationId, opts.queries, opts.periodDays, opts.order);
  const run = await loadRun(conversationId, key);
  // Выдачи роликов нет (не искали или кэш протух) — это НЕ повод показывать пустой
  // экран: свой список конкурентов лежит в БД и от поиска не зависит. Отдаём его,
  // а собранные из выдачи просто не считаем (поиск за человека не запускаем).
  if (!run || Date.now() - run.at >= RESULT_TTL_MS) {
    const own = await listTrackedChannels(conversationId);
    if (own.length === 0) return { status: "expired" };
    return {
      status: "ok",
      result: { channels: own, expandedFrom: 0, fetchedAt: new Date().toISOString() },
    };
  }

  const fromSearch = aggregateChannels(run.data.videos, opts.filters);
  // Свои каналы идут первыми и НЕ дублируются собранными: если канал из списка
  // попал ещё и в выдачу, переносим на него цифры (сколько роликов выстрелило) —
  // ради них раздел и открывают.
  const tracked = await listTrackedChannels(conversationId);
  const byId = new Map(fromSearch.map((c) => [c.id, c]));
  const manual = tracked.map((t) => {
    const hit = byId.get(t.id);
    // ⚠️ Из своей строки берём только пометку «мой» и id для удаления: остальное
    // (подписчики, аватар, цифры) свежее в выдаче — в БД лежит снимок с момента
    // добавления канала.
    return hit ? { ...hit, source: t.source, trackedId: t.trackedId } : t;
  });
  const manualIds = new Set(tracked.map((t) => t.id));
  const collected = fromSearch.filter((c) => !manualIds.has(c.id));
  const known = new Set([...fromSearch.map((c) => c.id), ...tracked.map((t) => t.id)]);

  try {
    // Расспрашиваем только верхушку: у каждого канала это отдельный вызов, а
    // хвост выдачи (один случайный ролик) рекомендаций всё равно почти не даёт.
    const seeds = [...manual, ...collected].slice(0, FEATURED_SEED_LIMIT);
    const suggested = new Map<string, string>(); // канал → кто его рекомендует
    for (const seed of seeds) {
      // Канал мог быть удалён или закрыт — тогда пропускаем его, а не валим режим.
      const ids = await fetchFeaturedChannels(seed.id).catch((err) => {
        if (err instanceof QuotaExhaustedError || err instanceof NoKeysError) throw err;
        console.error("[competitors] рекомендованные каналы", seed.id, err);
        return [] as string[];
      });
      for (const id of ids) {
        if (known.has(id) || suggested.has(id)) continue;
        if (run.data.videos.some((v) => v.channelId === id)) continue;
        suggested.set(id, seed.title);
      }
    }

    const extraIds = Array.from(suggested.keys());
    const info = extraIds.length ? await fetchChannelsByIds(extraIds) : new Map();
    const fromFeatured: CompetitorChannel[] = [];
    info.forEach((c) => {
      // Скрытый счётчик подписчиков — «не знаем», а не «ноль»: без него метрика
      // раздела не считается, показывать такой канал нечестно.
      if (c.hiddenSubscribers) return;
      fromFeatured.push({
        id: c.id,
        title: c.title,
        thumbnail: c.thumbnail,
        url: c.customUrl
          ? `https://www.youtube.com/${c.customUrl}`
          : `https://www.youtube.com/channel/${c.id}`,
        subscribers: c.subscribers,
        videoCount: c.videoCount,
        source: "featured",
        hits: 0,
        medianRatio: 0,
        topVideo: null,
        recommendedBy: suggested.get(c.id) ?? null,
      });
    });

    return {
      status: "ok",
      result: {
        channels: [
          ...manual,
          ...collected,
          ...fromFeatured.sort((a, b) => b.subscribers - a.subscribers),
        ],
        expandedFrom: seeds.length,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    // failure() типизирован под выдачу роликов — здесь нас интересуют только
    // причины сбоя (квота / нет ключей / прочее), результат в неё не попадает.
    const f = failure(err);
    if (f.status === "quota") return { status: "quota" };
    if (f.status === "no_keys") return { status: "no_keys" };
    return { status: "error", message: "Не удалось собрать каналы ниши" };
  }
}


// ── Свой список конкурентов (добавленные руками каналы) ──────────────────────
// Живёт в БД (TrackedChannel, пер-проектно), в отличие от собранных из выдачи:
// та выборка меняется от запроса к запросу и живёт 6 часов, а за своими следят
// постоянно. В общем списке идут первыми и помечены source:"manual".

export async function listTrackedChannels(
  conversationId: string
): Promise<CompetitorChannel[]> {
  const rows = await prisma.trackedChannel.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.channelId,
    title: r.title,
    thumbnail: r.thumbnail,
    url: r.customUrl
      ? `https://www.youtube.com/${r.customUrl}`
      : `https://www.youtube.com/channel/${r.channelId}`,
    subscribers: r.subscribers,
    videoCount: 0,
    source: "manual" as const,
    hits: 0,
    medianRatio: 0,
    topVideo: null,
    recommendedBy: null,
    trackedId: r.id,
  }));
}

export async function addTrackedChannel(
  conversationId: string,
  input: string
): Promise<
  | { status: "ok"; channel: CompetitorChannel }
  | { status: "not_found" }
  | { status: "no_keys" }
  | { status: "quota" }
  | { status: "error"; message: string }
> {
  if (!hasYoutubeKeys()) return { status: "no_keys" };
  try {
    const found = await resolveChannel(input);
    if (!found) return { status: "not_found" };

    // Повторное добавление — не ошибка: просто освежаем снимок карточки.
    const row = await prisma.trackedChannel.upsert({
      where: {
        conversationId_channelId: { conversationId, channelId: found.id },
      },
      create: {
        conversationId,
        channelId: found.id,
        title: found.title,
        thumbnail: found.thumbnail,
        customUrl: found.customUrl,
        subscribers: found.subscribers,
      },
      update: {
        title: found.title,
        thumbnail: found.thumbnail,
        customUrl: found.customUrl,
        subscribers: found.subscribers,
      },
    });

    return {
      status: "ok",
      channel: {
        id: found.id,
        title: found.title,
        thumbnail: found.thumbnail,
        url: found.customUrl
          ? `https://www.youtube.com/${found.customUrl}`
          : `https://www.youtube.com/channel/${found.id}`,
        subscribers: found.subscribers,
        videoCount: found.videoCount,
        source: "manual",
        hits: 0,
        medianRatio: 0,
        topVideo: null,
        recommendedBy: null,
        trackedId: row.id,
      },
    };
  } catch (err) {
    const f = failure(err);
    if (f.status === "quota") return { status: "quota" };
    if (f.status === "no_keys") return { status: "no_keys" };
    return { status: "error", message: "Не удалось найти канал" };
  }
}

export async function removeTrackedChannel(
  conversationId: string,
  trackedId: string
): Promise<boolean> {
  const row = await prisma.trackedChannel.findUnique({ where: { id: trackedId } });
  if (!row || row.conversationId !== conversationId) return false;
  await prisma.trackedChannel.delete({ where: { id: trackedId } });
  return true;
}

// ── Лента новых роликов отслеживаемых каналов ────────────────────────────────
//
// ⚠️ Дёшево ровно потому, что поиском тут не пользуемся: uploads-плейлист канала
// выводится из его id (2 units на канал — список id + метаданные), плюс один
// channels.list на все каналы разом ради свежих подписчиков. Десять конкурентов —
// около 21 unit против 100 за ОДИН поисковый запрос.
//
// Заодно пишем дневной снимок цифр: у YouTube истории нет, «кто растёт, а кто
// стоит» видно, только если копить самим.

const FEED_TTL_MS = 30 * 60 * 1000;
const FEED_VIDEOS_PER_CHANNEL = 20;
const feedCache = new Map<string, { at: number; data: TrackedFeedResult }>();

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function loadTrackedFeed(
  conversationId: string,
  days: number,
  force = false
): Promise<
  | { status: "ok"; result: TrackedFeedResult; cached: boolean }
  | { status: "empty" }
  | { status: "no_keys" }
  | { status: "quota" }
  | { status: "error"; message: string }
> {
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const rows = await prisma.trackedChannel.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return { status: "empty" };

  const key = `${conversationId}|feed|${days}`;
  const hit = feedCache.get(key);
  if (!force && hit && Date.now() - hit.at < FEED_TTL_MS) {
    return { status: "ok", result: hit.data, cached: true };
  }

  const since = Date.now() - days * DAY_MS;

  try {
    // Свежие подписчики сразу по всем каналам — 1 unit на 50.
    const info = await fetchChannelsByIds(rows.map((r) => r.channelId));

    const videos: CompetitorVideo[] = [];
    const channels: TrackedChannelRow[] = [];
    const today = utcDay(new Date());

    for (const row of rows) {
      const ch = info.get(row.channelId);
      const subscribers = ch?.subscribers ?? row.subscribers;

      // ⚠️ Один битый канал не должен ронять ленту целиком: канал могли удалить,
      // переименовать или закрыть, и тогда playlistItems отвечает 404. Такой канал
      // просто остаётся без новинок, остальные показываются.
      const uploads = await fetchChannelUploads(row.channelId, FEED_VIDEOS_PER_CHANNEL).catch(
        (err) => {
          if (err instanceof QuotaExhaustedError || err instanceof NoKeysError) throw err;
          console.error("[competitors] лента канала", row.channelId, err);
          return [] as Awaited<ReturnType<typeof fetchChannelUploads>>;
        }
      );
      const fresh = uploads.filter(
        (v) => v.publishedAt && new Date(v.publishedAt).getTime() >= since
      );

      for (const v of fresh) {
        const sec = isoSeconds(v.duration);
        videos.push({
          id: v.id,
          title: v.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
          duration: v.duration,
          isShort: sec > 0 && sec <= SHORT_MAX_SECONDS,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          channelId: row.channelId,
          channelTitle: ch?.title ?? row.title,
          channelThumb: ch?.thumbnail ?? row.thumbnail,
          channelUrl: row.customUrl
            ? `https://www.youtube.com/${row.customUrl}`
            : `https://www.youtube.com/channel/${row.channelId}`,
          subscribers,
          // ⚠️ Кратность у свежего ролика ЗАНИЖЕНА, и это нормально: он ещё
          // набирает. Здесь метрика не приговор, а «этот пошёл быстрее прочих».
          ratio: viewsPerSub(v.views, subscribers),
          query: "лента конкурентов",
        });
      }

      if (ch) {
        // Снимок цифр — не чаще раза в сутки на канал (уникальный ключ по дню).
        await prisma.trackedChannelStat
          .upsert({
            where: { channelRowId_day: { channelRowId: row.id, day: today } },
            create: {
              channelRowId: row.id,
              day: today,
              subscribers: ch.subscribers,
              views: BigInt(ch.views),
              videoCount: ch.videoCount,
            },
            update: {
              subscribers: ch.subscribers,
              views: BigInt(ch.views),
              videoCount: ch.videoCount,
            },
          })
          .catch((err) => console.error("[competitors] снимок канала не записан:", err));

        // Освежаем и снимок карточки в БД: подписчики и название меняются.
        if (ch.subscribers !== row.subscribers || ch.title !== row.title) {
          await prisma.trackedChannel
            .update({
              where: { id: row.id },
              data: { subscribers: ch.subscribers, title: ch.title, thumbnail: ch.thumbnail },
            })
            .catch(() => {});
        }
      }

      const history = await prisma.trackedChannelStat.findMany({
        where: { channelRowId: row.id },
        orderBy: { day: "asc" },
        select: { day: true, subscribers: true },
      });
      const growth = weeklyGrowth(history);

      channels.push({
        trackedId: row.id,
        channelId: row.channelId,
        title: ch?.title ?? row.title,
        thumbnail: ch?.thumbnail ?? row.thumbnail,
        url: row.customUrl
          ? `https://www.youtube.com/${row.customUrl}`
          : `https://www.youtube.com/channel/${row.channelId}`,
        subscribers,
        videoCount: ch?.videoCount ?? 0,
        subsPerWeek: growth.subsPerWeek,
        trackedDays: growth.spanDays,
        fresh: fresh.length,
      });
    }

    const result: TrackedFeedResult = {
      channels,
      videos: videos.sort((a, b) => b.ratio - a.ratio),
      days,
      fetchedAt: new Date().toISOString(),
    };
    feedCache.set(key, { at: Date.now(), data: result });
    return { status: "ok", result, cached: false };
  } catch (err) {
    const f = failure(err);
    if (f.status === "quota") return { status: "quota" };
    if (f.status === "no_keys") return { status: "no_keys" };
    return { status: "error", message: "Не удалось получить ленту конкурентов" };
  }
}

/**
 * Прирост подписчиков за неделю по НАШИМ снимкам.
 *
 * ⚠️ Берём окно в 7 дней от последнего снимка, а НЕ первый снимок за всю историю:
 * иначе через полгода цифра превратится в среднее за полгода и перестанет
 * показывать, что происходит сейчас. Опорным считаем ближайший снимок, который
 * не новее чем неделю назад; нет такого (историю только начали копить) — берём
 * самый ранний и пересчитываем на неделю по фактическому промежутку.
 *
 * ⚠️ Нужно минимум два снимка в разные дни, иначе делить не на что — тогда честно
 * отдаём null («копим цифры»), а не ноль: ноль читался бы как «канал не растёт».
 */
function weeklyGrowth(
  history: Array<{ day: Date; subscribers: number }>
): { subsPerWeek: number | null; spanDays: number } {
  if (history.length < 2) return { subsPerWeek: null, spanDays: history.length };
  const last = history[history.length - 1];
  const weekAgo = last.day.getTime() - 7 * DAY_MS;

  // История отсортирована по возрастанию дня — ищем последний снимок не новее недели.
  let base = history[0];
  for (const point of history) {
    if (point === last) break;
    if (point.day.getTime() <= weekAgo) base = point;
  }

  const spanDays = Math.round((last.day.getTime() - base.day.getTime()) / DAY_MS);
  if (spanDays <= 0) return { subsPerWeek: null, spanDays: 1 };
  const totalSpan = Math.round((last.day.getTime() - history[0].day.getTime()) / DAY_MS);
  return {
    subsPerWeek: Math.round(((last.subscribers - base.subscribers) / spanDays) * 7),
    spanDays: Math.max(totalSpan, 1),
  };
}

/**
 * Свежайшая лента конкурентов ИЗ ПАМЯТИ — без единого похода в YouTube.
 *
 * ⚠️ Нужна чату: там контекст собирается на каждое сообщение, и платить за него
 * units нельзя. Кэша нет (никто не открывал раздел / был рестарт) — отдаём null,
 * а не грузим ленту: чат обойдётся без этой части контекста.
 */
export function cachedTrackedFeed(conversationId: string): TrackedFeedResult | null {
  let best: { at: number; data: TrackedFeedResult } | null = null;
  Array.from(feedCache.entries()).forEach(([k, v]) => {
    if (!k.startsWith(`${conversationId}|feed|`)) return;
    if (!best || v.at > best.at) best = v;
  });
  return best ? (best as { at: number; data: TrackedFeedResult }).data : null;
}

/** Сброс кэша ленты — состав списка конкурентов изменился. */
export function clearTrackedFeedCache(conversationId: string): void {
  Array.from(feedCache.keys()).forEach((k) => {
    if (k.startsWith(`${conversationId}|feed|`)) feedCache.delete(k);
  });
}


// ── Разбор конкретного ролика-референса ──────────────────────────────────────
//
// Что собираем: метаданные ролика (`videos.list`, 1 unit — название, ОПИСАНИЕ,
// метрики) + топ-комментарии (`commentThreads.list`, 1 unit) + подписчиков канала
// (`channels.list`, 1 unit). Итого 3 units на ролик — против 100 за поиск.
//
// ⚠️ Транскрипта тут нет и быть не может: `captions.download` требует OAuth
// владельца канала. Поэтому промпт честно говорит модели, что ролик не просмотрен,
// и просит разбирать по названию, описанию и реакции зрителей (см. insightPromptBlock).
//
// Кэш общий на всех: данные публичные и от проекта не зависят.
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000;

const insightCache = new Map<string, { at: number; data: VideoInsight }>();

export async function fetchVideoInsight(
  videoId: string
): Promise<
  | { status: "ok"; insight: VideoInsight }
  | { status: "not_found" }
  | { status: "no_keys" }
  | { status: "quota" }
  | { status: "error"; message: string }
> {
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const hit = insightCache.get(videoId);
  if (hit && Date.now() - hit.at < INSIGHT_TTL_MS) {
    return { status: "ok", insight: hit.data };
  }

  try {
    const [video] = await fetchVideosByIds([videoId]);
    if (!video) return { status: "not_found" };

    // Комментарии best-effort: у ролика их могли отключить, разбор от этого не
    // разваливается — просто без блока реакции.
    const [comments, channels] = await Promise.all([
      fetchTopComments(videoId),
      video.channelId
        ? fetchChannelsByIds([video.channelId])
        : Promise.resolve(new Map<string, PublicChannel>()),
    ]);

    const insight: VideoInsight = {
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      publishedAt: video.publishedAt,
      duration: video.duration,
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      subscribers: channels.get(video.channelId)?.subscribers ?? 0,
      description: video.description,
      topComments: comments,
    };
    insightCache.set(videoId, { at: Date.now(), data: insight });
    return { status: "ok", insight };
  } catch (err) {
    const f = failure(err);
    if (f.status === "quota") return { status: "quota" };
    if (f.status === "no_keys") return { status: "no_keys" };
    return { status: "error", message: "Не удалось получить данные ролика" };
  }
}
