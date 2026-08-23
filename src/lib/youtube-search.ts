import { ytPublicGet } from "./youtube-keys";
import { fetchSearchContinuation, fetchSearchPage } from "./youtube-scrape";

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
  nextPageToken?: string;
}

export type SearchOrder = "viewCount" | "relevance" | "date";

/** Потолок выдачи одной страницы — жёсткий лимит API. */
export const SEARCH_PAGE_SIZE = 50;

export interface SearchPage {
  ids: string[];
  /** Токен следующей страницы; null — выдача кончилась. */
  nextPageToken: string | null;
}

/**
 * Одна страница выдачи по запросу: id роликов + токен следующей страницы.
 *
 * ⚠️ Метаданные добираем отдельным videos.list: у search.list снippet усечённый —
 * ни просмотров, ни длительности, ни подписчиков канала там нет, а именно они нам
 * и нужны. Зато videos.list стоит 1 unit на 50 роликов, так что добор почти бесплатный.
 *
 * ⚠️ 50 роликов на страницу — лимит API, поднять нельзя. Глубже листаем по
 * `nextPageToken`, и КАЖДАЯ страница стоит свои 100 units — поэтому листаем не
 * заранее «на всякий случай», а по кнопке «Показать ещё» (см. competitors-server.ts).
 * Дальше ~500 результатов на запрос YouTube не отдаёт вовсе — вернёт пустой токен.
 */
export async function searchVideoPage(opts: {
  q: string;
  order?: SearchOrder;
  publishedAfter?: string | null;
  pageToken?: string | null;
}): Promise<SearchPage> {
  const p = new URLSearchParams({
    part: "id",
    type: "video",
    q: opts.q,
    order: opts.order ?? "viewCount",
    maxResults: String(SEARCH_PAGE_SIZE),
    // Ниши у нас РФ/СНГ: без этих двух параметров в топ лезет англоязычная выдача.
    // ⚠️ Это лишь подсказка ранжирования, а не фильтр — иностранные ролики всё равно
    // проскакивают, поэтому язык проверяется ещё раз по метаданным (competitors.ts).
    relevanceLanguage: "ru",
    regionCode: "RU",
  });
  if (opts.publishedAfter) p.set("publishedAfter", opts.publishedAfter);
  if (opts.pageToken) p.set("pageToken", opts.pageToken);

  const data = await ytPublicGet<SearchResponse>(`${API}/search?${p.toString()}`, SEARCH_COST);
  const ids: string[] = [];
  for (const it of data.items ?? []) {
    const id = it.id?.videoId;
    if (id) ids.push(id);
  }
  return { ids, nextPageToken: data.nextPageToken ?? null };
}

/**
 * Страница выдачи, но СНАЧАЛА бесплатным путём.
 *
 * ⚠️⚠️ Ради этого затевалось: `search.list` стоит 100 units из 10 000 суточных —
 * то есть сто поисков в день на весь продукт, отсюда и потолок в 4 страницы, и
 * «лимит на сегодня исчерпан». Те же id лежат на публичной странице выдачи, а
 * листается она внутренним continuation-эндпоинтом — обе операции бесплатны
 * (см. youtube-scrape.ts). Метаданные всё равно добираются отдельным
 * `videos.list` за 1 unit на полсотни роликов, так что качество не страдает.
 *
 * ⚠️ Путь неофициальный и может отвалиться в любой день — поэтому при любом сбое
 * молча уходим в API, и раздел продолжает работать как раньше, просто дороже.
 *
 * ⚠️ Период (`publishedAfter`) бесплатный путь НЕ фильтрует: у страницы есть только
 * грубые «неделя/месяц/год», а у нас 30/90/365. Отсекаем по дате уже после добора
 * метаданных — там точный `publishedAt` (см. collectPage). Листать при этом дороже
 * не стало: продолжения бесплатны.
 */
export async function searchVideoPageCheap(opts: {
  q: string;
  order?: SearchOrder;
  publishedAfter?: string | null;
  pageToken?: string | null;
}): Promise<SearchPage> {
  const token = opts.pageToken ?? null;

  // Продолжение бесплатного пути: наш токен сериализован и помечен префиксом,
  // чтобы не путать его с pageToken самого API.
  if (token && token.startsWith(FREE_TOKEN_PREFIX)) {
    try {
      const state = JSON.parse(token.slice(FREE_TOKEN_PREFIX.length)) as {
        apiKey: string | null;
        clientVersion: string | null;
        continuation: string | null;
      };
      const more = await fetchSearchContinuation(state);
      if (more) {
        return {
          ids: more.ids,
          nextPageToken: more.continuation
            ? `${FREE_TOKEN_PREFIX}${JSON.stringify({ ...state, continuation: more.continuation })}`
            : null,
        };
      }
    } catch {
      /* сломалось продолжение — начинаем страницу заново через API ниже */
    }
    // Бесплатное продолжение не вышло: платного эквивалента у этого токена нет,
    // поэтому честно говорим «дальше нечего», а не платим 100 units за первую
    // страницу повторно.
    return { ids: [], nextPageToken: null };
  }

  // Первая страница: пробуем бесплатно.
  if (!token) {
    // ⚠️ Период передаём В ЗАПРОС, а не отсекаем только после: сортировка по
    // просмотрам без фильтра даты отдаёт всевременной топ, и на широком запросе
    // свежих роликов в выдаче не оказывается вовсе (ловили на «майнкрафт»).
    const page = await fetchSearchPage(opts.q, {
      order: opts.order,
      periodDays: daysFrom(opts.publishedAfter),
    }).catch(() => null);
    if (page && page.ids.length > 0) {
      const state = {
        apiKey: page.apiKey,
        clientVersion: page.clientVersion,
        continuation: page.continuation,
      };
      return {
        ids: page.ids,
        nextPageToken: page.continuation
          ? `${FREE_TOKEN_PREFIX}${JSON.stringify(state)}`
          : null,
      };
    }
  }

  return searchVideoPage(opts);
}

export const FREE_TOKEN_PREFIX = "free:";

/** Сколько дней назад начинается окно (из ISO-даты, которую ждёт Data API). */
function daysFrom(publishedAfter?: string | null): number | null {
  if (!publishedAfter) return null;
  const from = Date.parse(publishedAfter);
  if (Number.isNaN(from)) return null;
  return Math.max(1, Math.round((Date.now() - from) / (24 * 60 * 60 * 1000)));
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
  /**
   * Описание ролика. ⚠️ Чужое описание API отдаёт (в отличие от тегов, которые с
   * 2021 видит только владелец), и часто это фактически структура ролика: там
   * тайм-коды, ссылки и обещания автора.
   */
  description: string;
  /**
   * Язык ролика: `defaultAudioLanguage` (язык дорожки), иначе `defaultLanguage`
   * (язык названия/описания). Пусто — автор не заполнил, и это частый случай.
   * Приходит в том же `part=snippet`, который мы и так тянем, — бесплатно.
   */
  language: string;
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
      description?: string;
      publishedAt?: string;
      thumbnails?: Thumbnails;
      channelId?: string;
      channelTitle?: string;
      defaultAudioLanguage?: string;
      defaultLanguage?: string;
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
        description: s.description ?? "",
        thumbnail: pickThumb(s.thumbnails),
        publishedAt: s.publishedAt ?? "",
        duration: v.contentDetails?.duration ?? "",
        views: Number(st.viewCount ?? 0),
        likes: Number(st.likeCount ?? 0),
        comments: Number(st.commentCount ?? 0),
        channelId: s.channelId ?? "",
        channelTitle: s.channelTitle ?? "",
        language: s.defaultAudioLanguage ?? s.defaultLanguage ?? "",
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
  /** Суммарные просмотры канала. Приходят в том же part=statistics — бесплатно. */
  views: number;
}

interface ChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: Thumbnails };
    statistics?: {
      subscriberCount?: string;
      videoCount?: string;
      viewCount?: string;
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
        views: Number(st.viewCount ?? 0),
      });
    }
  }
  return map;
}

/**
 * «Рекомендованные каналы» конкретного канала — секции типа multipleChannels
 * (`channelSections.list`, 1 unit).
 *
 * ⚠️ Это ЕДИНСТВЕННЫЙ способ получить «похожие каналы» из официального API:
 * эндпоинта related-channels в Data API v3 нет, а `search.list?type=channel`
 * матчит только название и описание канала (и стоит 100 units). Здесь же —
 * каналы, которые автор ВРУЧНУЮ поставил себе на страницу: почти всегда это
 * коллеги по нише, то есть сигнал точнее любого текстового поиска.
 *
 * ⚠️ Заполнено далеко не у всех (у части каналов секции пустые) — поэтому это
 * ДОПОЛНЕНИЕ к агрегации выдачи, а не замена ей. Свой канал в такую секцию
 * положить нельзя, так что дедупликация нужна только между донорами.
 */
export async function fetchFeaturedChannels(channelId: string): Promise<string[]> {
  const data = await ytPublicGet<ChannelSectionsResponse>(
    `${API}/channelSections?part=contentDetails,snippet&channelId=${encodeURIComponent(channelId)}`,
    LIST_COST
  );
  const out: string[] = [];
  for (const item of data.items ?? []) {
    const type = item.snippet?.type ?? "";
    if (type !== "multipleChannels" && type !== "singleChannel") continue;
    for (const id of item.contentDetails?.channels ?? []) out.push(id);
  }
  return Array.from(new Set(out));
}

interface ChannelSectionsResponse {
  items?: Array<{
    snippet?: { type?: string };
    contentDetails?: { channels?: string[] };
  }>;
}

/**
 * Найти канал по тому, что человек вставил: ссылка, @хэндл или channel ID.
 *
 * Цена зависит от формы ввода, и это важно:
 *  • channel ID (UC…) и @хэндл → `channels.list` по id/forHandle — **1 unit**;
 *  • всё остальное (просто название) → `search.list?type=channel` — **100 units**,
 *    как обычный поиск. Поэтому дорогой путь идёт последним и только если дешёвые
 *    не сработали, а UI предупреждает о цене заранее.
 *
 * ⚠️ Старые ссылки вида /c/Name и /user/Name резолвим через forUsername (1 unit),
 * но у большинства современных каналов это уже не работает — тогда падаем в поиск.
 */
export async function resolveChannel(input: string): Promise<PublicChannel | null> {
  const raw = input.trim();
  if (!raw) return null;

  const byId = (id: string) => fetchChannelsByIds([id]).then((m) => m.get(id) ?? null);

  // 1. Голый channel ID.
  if (/^UC[\w-]{20,}$/.test(raw)) return byId(raw);

  // 2. Ссылка любой формы.
  const url = /youtube\.com|youtu\.be/.test(raw) ? raw : null;
  if (url) {
    const chan = /\/channel\/(UC[\w-]{20,})/.exec(url);
    if (chan) return byId(chan[1]);
    const handle = /\/@([\w.-]+)/.exec(url);
    if (handle) return byHandle(`@${handle[1]}`);
    // ⚠️ Ссылку на РОЛИК тоже принимаем: человек чаще всего копирует именно её
    // («вот у этого канала залетело»). Без этой ветки такая ссылка уходила бы в
    // поиск по названию за 100 units и находила мусор. Ролик → его канал = 1 unit.
    const video =
      /youtu\.be\/([\w-]{6,})/.exec(url) ??
      /[?&]v=([\w-]{6,})/.exec(url) ??
      /\/shorts\/([\w-]{6,})/.exec(url) ??
      /\/live\/([\w-]{6,})/.exec(url);
    if (video) {
      const [found] = await fetchVideosByIds([video[1]]);
      if (found?.channelId) return byId(found.channelId);
      return null;
    }

    const legacy = /\/(?:c|user)\/([\w.-]+)/.exec(url);
    if (legacy) {
      const found = await byUsername(legacy[1]);
      if (found) return found;
      return searchChannel(legacy[1]);
    }
  }

  // 3. @хэндл без ссылки.
  if (raw.startsWith("@")) {
    const found = await byHandle(raw);
    if (found) return found;
  }

  // 4. Название — дорого (100 units), поэтому последним.
  return searchChannel(raw.replace(/^@/, ""));
}

async function byHandle(handle: string): Promise<PublicChannel | null> {
  const data = await ytPublicGet<ChannelsResponse>(
    `${API}/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}`,
    LIST_COST
  );
  return firstChannel(data);
}

async function byUsername(name: string): Promise<PublicChannel | null> {
  const data = await ytPublicGet<ChannelsResponse>(
    `${API}/channels?part=snippet,statistics&forUsername=${encodeURIComponent(name)}`,
    LIST_COST
  );
  return firstChannel(data);
}

/** Поиск канала по названию — 100 units, как любой search.list. */
async function searchChannel(q: string): Promise<PublicChannel | null> {
  const data = await ytPublicGet<{ items?: Array<{ id?: { channelId?: string } }> }>(
    `${API}/search?part=id&type=channel&maxResults=1&q=${encodeURIComponent(q)}`,
    SEARCH_COST
  );
  const id = data.items?.[0]?.id?.channelId;
  return id ? fetchChannelsByIds([id]).then((m) => m.get(id) ?? null) : null;
}

function firstChannel(data: ChannelsResponse): PublicChannel | null {
  const c = data.items?.[0];
  if (!c) return null;
  const s = c.snippet ?? {};
  const st = c.statistics ?? {};
  return {
    id: c.id,
    title: s.title ?? "",
    thumbnail: pickThumb(s.thumbnails),
    customUrl: s.customUrl ?? null,
    subscribers: Number(st.subscriberCount ?? 0),
    hiddenSubscribers: Boolean(st.hiddenSubscriberCount),
    videoCount: Number(st.videoCount ?? 0),
    views: Number(st.viewCount ?? 0),
  };
}

/**
 * Последние ролики канала через его uploads-плейлист — 1 unit на 50 id.
 *
 * ⚠️ Uploads-плейлист выводится из channelId (UC… → UU…), поэтому лишнего запроса
 * `channels.list?part=contentDetails` не нужно. Это стабильное правило YouTube,
 * а не догадка: id плейлиста «все загрузки» отличается от id канала второй буквой.
 * Итого лента конкурента стоит 2 units (id + метаданные), против 100 у поиска.
 */
export async function fetchChannelUploads(
  channelId: string,
  limit = 20
): Promise<PublicVideo[]> {
  const playlistId = `UU${channelId.slice(2)}`;
  const data = await ytPublicGet<PlaylistItemsResponse>(
    `${API}/playlistItems?part=contentDetails&maxResults=${Math.min(limit, 50)}` +
      `&playlistId=${encodeURIComponent(playlistId)}`,
    LIST_COST
  );
  const ids: string[] = [];
  for (const it of data.items ?? []) {
    const id = it.contentDetails?.videoId;
    if (id) ids.push(id);
  }
  return ids.length ? fetchVideosByIds(ids) : [];
}

interface PlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
}

/**
 * Топ-комментарии под чужим роликом (`commentThreads.list`, 1 unit).
 *
 * ⚠️ Зачем в разборе референса: комментарии — единственный доступный нам источник
 * РЕАКЦИИ зрителя (что зацепило, что осталось непонятным, о чём просят ещё).
 * Транскрипт получить нельзя: `captions.download` требует OAuth владельца канала.
 *
 * ⚠️ У ролика могут быть выключены комментарии — тогда API отвечает 403
 * `commentsDisabled`. Это не ошибка разбора: возвращаем пустой список.
 */
export async function fetchTopComments(
  videoId: string,
  limit = 15
): Promise<{ text: string; likes: number }[]> {
  try {
    const data = await ytPublicGet<CommentThreadsResponse>(
      `${API}/commentThreads?part=snippet&order=relevance&textFormat=plainText` +
        `&maxResults=${Math.min(limit, 50)}&videoId=${encodeURIComponent(videoId)}`,
      LIST_COST
    );
    return (data.items ?? [])
      .map((it) => {
        const c = it.snippet?.topLevelComment?.snippet;
        return { text: (c?.textDisplay ?? "").trim(), likes: Number(c?.likeCount ?? 0) };
      })
      .filter((c) => c.text.length > 0);
  } catch (err) {
    console.error("[youtube] комментарии недоступны", videoId, err);
    return [];
  }
}

interface CommentThreadsResponse {
  items?: Array<{
    snippet?: {
      topLevelComment?: { snippet?: { textDisplay?: string; likeCount?: number } };
    };
  }>;
}
