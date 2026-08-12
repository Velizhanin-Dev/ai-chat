import { ytPublicGet } from "./youtube-keys";

// ── Публичный поиск по YouTube (раздел «Конкуренты в нише») ───────────────────
// Отдельно от youtube.ts: там интеграция с каналом ПОЛЬЗОВАТЕЛЯ (OAuth, аналитика,
// токены в БД), а тут — чужие, публичные данные, для которых авторизация не нужна:
// хватает API-ключа. Ключи берём из пула с ротацией (youtube-keys.ts), потому что
// search.list стоит 100 units против 1 у остальных вызовов.

const SEARCH_COST = 100;
const LIST_COST = 1;

type Thumb = { url?: string };
interface Thumbnails {
  default?: Thumb;
  medium?: Thumb;
  high?: Thumb;
  standard?: Thumb;
  maxres?: Thumb;
}

function pickThumb(t?: Thumbnails): string | null {
  return t?.high?.url ?? t?.medium?.url ?? t?.standard?.url ?? t?.default?.url ?? null;
}

const API = "https://www.googleapis.com/youtube/v3";

interface SearchResponse {
  items?: Array<{ id?: { videoId?: string } }>;
}

export type SearchOrder = "viewCount" | "relevance" | "date";

/**
 * Ищет ролики по запросу, отдаёт только id.
 *
 * ⚠️ Метаданные добираем отдельным videos.list: у search.list снippet усечённый —
 * ни просмотров, ни длительности, ни подписчиков канала там нет, а именно они нам
 * и нужны. Зато videos.list стоит 1 unit на 50 роликов, так что добор почти бесплатный.
 */
export async function searchVideoIds(opts: {
  q: string;
  order?: SearchOrder;
  publishedAfter?: string | null;
  max?: number;
}): Promise<string[]> {
  const p = new URLSearchParams({
    part: "id",
    type: "video",
    q: opts.q,
    order: opts.order ?? "viewCount",
    maxResults: String(Math.min(Math.max(opts.max ?? 50, 1), 50)),
    // Ниши у нас РФ/СНГ: без этих двух параметров в топ лезет англоязычная выдача.
    relevanceLanguage: "ru",
    regionCode: "RU",
  });
  if (opts.publishedAfter) p.set("publishedAfter", opts.publishedAfter);

  const data = await ytPublicGet<SearchResponse>(`${API}/search?${p.toString()}`, SEARCH_COST);
  return (data.items ?? [])
    .map((it) => it.id?.videoId)
    .filter((v): v is string => Boolean(v));
}

export interface PublicVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  duration: string; // ISO-8601
  views: number;
  likes: number;
  comments: number;
  channelId: string;
  channelTitle: string;
}

// ⚠️ Тегов чужого ролика тут нет и быть не может: с 2021 года YouTube отдаёт
// snippet.tags только владельцу видео. Свои теги мы берём другим путём — через
// OAuth-токен канала (fetchRecentVideos), и как раз из них собираются подсказки
// поисковых запросов.
interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      publishedAt?: string;
      thumbnails?: Thumbnails;
      channelId?: string;
      channelTitle?: string;
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }>;
}

/** Данные роликов по списку id — пачками по 50 (лимит API), 1 unit на пачку. */
export async function fetchVideosByIds(ids: string[]): Promise<PublicVideo[]> {
  const out: PublicVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await ytPublicGet<VideosResponse>(
      `${API}/videos?part=snippet,statistics,contentDetails&id=${batch.join(",")}`,
      LIST_COST
    );
    for (const v of data.items ?? []) {
      const s = v.snippet ?? {};
      const st = v.statistics ?? {};
      out.push({
        id: v.id,
        title: s.title ?? "",
        thumbnail: pickThumb(s.thumbnails),
        publishedAt: s.publishedAt ?? "",
        duration: v.contentDetails?.duration ?? "",
        views: Number(st.viewCount ?? 0),
        likes: Number(st.likeCount ?? 0),
        comments: Number(st.commentCount ?? 0),
        channelId: s.channelId ?? "",
        channelTitle: s.channelTitle ?? "",
      });
    }
  }
  return out;
}

export interface PublicChannel {
  id: string;
  title: string;
  thumbnail: string | null;
  customUrl: string | null;
  subscribers: number;
  /** Счётчик подписчиков скрыт владельцем: API отдаёт 0, и это «не знаем», а не «ноль». */
  hiddenSubscribers: boolean;
  videoCount: number;
}

interface ChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: Thumbnails };
    statistics?: {
      subscriberCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
}

/** Публичные данные чужих каналов (нужен subscriberCount + аватар), 1 unit на 50. */
export async function fetchChannelsByIds(ids: string[]): Promise<Map<string, PublicChannel>> {
  const map = new Map<string, PublicChannel>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await ytPublicGet<ChannelsResponse>(
      `${API}/channels?part=snippet,statistics&id=${batch.join(",")}`,
      LIST_COST
    );
    for (const c of data.items ?? []) {
      const s = c.snippet ?? {};
      const st = c.statistics ?? {};
      map.set(c.id, {
        id: c.id,
        title: s.title ?? "",
        thumbnail: pickThumb(s.thumbnails),
        customUrl: s.customUrl ?? null,
        subscribers: Number(st.subscriberCount ?? 0),
        hiddenSubscribers: Boolean(st.hiddenSubscriberCount),
        videoCount: Number(st.videoCount ?? 0),
      });
    }
  }
  return map;
}
