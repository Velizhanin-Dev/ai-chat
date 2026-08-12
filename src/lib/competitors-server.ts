import { prisma } from "./prisma";
import { sanitizeBrief, type Brief } from "./brief";
import {
  getValidAccessToken,
  fetchChannelInfo,
  fetchRecentVideos,
} from "./youtube";
import {
  searchVideoIds,
  fetchVideosByIds,
  fetchChannelsByIds,
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
  COMPETITOR_SEARCH_COST,
  SHORT_MAX_SECONDS,
  isoSeconds,
  suggestQueries,
  viewsPerSub,
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

const resultCache = new Map<string, { at: number; data: CompetitorResult }>();
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
    const page = info.uploadsPlaylistId
      ? await fetchRecentVideos(token, info.uploadsPlaylistId, 20)
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
}

export async function getCompetitorContext(
  conversationId: string
): Promise<CompetitorContext> {
  const [brief, hint] = await Promise.all([
    projectBrief(conversationId),
    channelHint(conversationId),
  ]);
  return {
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

export async function runCompetitorSearch(
  conversationId: string,
  opts: {
    queries: string[];
    periodDays: number;
    order: CompetitorOrder;
    force?: boolean;
  }
): Promise<CompetitorOutcome> {
  const { queries, periodDays, order } = opts;
  if (queries.length === 0) return { status: "error", message: "Не задан ни один запрос" };
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const key = resultKey(conversationId, queries, periodDays, order);
  const cached = resultCache.get(key);
  if (!opts.force && cached && Date.now() - cached.at < RESULT_TTL_MS) {
    return { status: "ok", result: cached.data, cached: true };
  }

  const hint = await channelHint(conversationId);
  const publishedAfter =
    periodDays > 0 ? new Date(Date.now() - periodDays * DAY_MS).toISOString() : null;

  try {
    // Один ролик может найтись по нескольким запросам — запоминаем первый,
    // чтобы потом было видно, какое ключевое слово реально приносит выдачу.
    const foundBy = new Map<string, string>();
    for (const q of queries) {
      const ids = await searchVideoIds({ q, order, publishedAfter });
      for (const id of ids) if (!foundBy.has(id)) foundBy.set(id, q);
    }

    const ids = Array.from(foundBy.keys());
    const videos = ids.length ? await fetchVideosByIds(ids) : [];

    const channelIds = Array.from(
      new Set(videos.map((v) => v.channelId).filter(Boolean))
    );
    const channels = channelIds.length
      ? await fetchChannelsByIds(channelIds)
      : new Map<string, PublicChannel>();

    let hiddenSubs = 0;
    const rows: CompetitorVideo[] = [];
    for (const v of videos) {
      // Свой канал в конкурентах не показываем.
      if (hint.channelId && v.channelId === hint.channelId) continue;
      const ch = channels.get(v.channelId);
      if (!ch) continue;
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
    rows.sort((a, b) => b.ratio - a.ratio);

    const result: CompetitorResult = {
      queries,
      periodDays,
      order,
      fetchedAt: new Date().toISOString(),
      scanned: videos.length,
      hiddenSubs,
      videos: rows,
    };
    resultCache.set(key, { at: Date.now(), data: result });
    return { status: "ok", result, cached: false };
  } catch (err) {
    if (err instanceof QuotaExhaustedError) return { status: "quota" };
    if (err instanceof NoKeysError) return { status: "no_keys" };
    console.error("[competitors] поиск не удался:", err);
    return { status: "error", message: "Не удалось получить выдачу YouTube" };
  }
}

export function normalizeOrder(v: unknown): SearchOrder {
  return v === "relevance" || v === "date" ? v : "viewCount";
}

export function normalizePeriod(v: unknown): number {
  const n = Number(v);
  return n === 0 || n === 30 || n === 90 || n === 365 ? n : 90;
}
