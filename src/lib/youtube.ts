import { randomBytes } from "crypto";
import type { YouTubeIntegration } from "@prisma/client";
import { prisma } from "./prisma";
import type {
  YouTubeChannelInfo,
  YouTubeVideo,
  DailyPoint,
  PeriodMetrics,
  VideoDetail,
  TrafficSource,
  SubscriberVideo,
  AudienceData,
  Granularity,
  SubscriberTimeline,
  SubscriberTimelineBucket,
  SubscriberTimelineVideo,
  YouTubeData,
  ChannelSnapshot,
  VideoPage,
} from "./youtube-types";

// ── Интеграция с YouTube (Google OAuth + YouTube Data API v3 / Analytics API) ──
// Подключается в настройках, ОТДЕЛЬНО от OAuth-входа (VK/Яндекс): юзер уже
// залогинен, а мы получаем и храним токены доступа к его каналу. access_token
// живёт ~1ч — обновляем по refresh_token. Данные тянем живыми в /data.

// Cookie с антифрод-state на время редиректа к Google.
export const YT_STATE_COOKIE = "yt_oauth_state";

// Права: чтение канала/видео (Data API) + аналитика по дням (Analytics API).
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// Должен совпадать с Authorized redirect URI в Google Cloud Console.
export function youtubeRedirectUri(): string {
  return `${appUrl()}/api/integrations/youtube/callback`;
}

interface Creds {
  clientId: string;
  clientSecret: string;
}

// null, если Google-приложение не сконфигурировано (нет ключей в env).
export function googleCreds(): Creds | null {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

export function youtubeConfigured(): boolean {
  return googleCreds() !== null;
}

export function randomState(): string {
  return randomBytes(16).toString("hex");
}

// Проверяет, что проект (диалог) существует и принадлежит юзеру. Возвращает id
// проекта или null — интеграция пер-проектная, поэтому все роуты сперва сверяют
// владение (чужой/несуществующий проект трогать нельзя).
export async function assertOwnedProject(
  userId: string,
  projectId: string
): Promise<string | null> {
  if (!projectId) return null;
  const conv = await prisma.conversation.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return conv?.id ?? null;
}

// ── Кэш дашборда «Канал» (экономия квоты YouTube API) ─────────────────────────
// Один заход на дашборд = ~13+ вызовов YouTube API (канал, видео+аналитика, период
// ×2, трафик, подписчики, аудитория + до 6 запросов таймлайна). Переключение
// периода (7/28/90/365) и повторные заходы дёргали всё заново → квота таяла.
// Кэшируем СОБРАННЫЙ payload по ключу (проект:период) в памяти процесса с TTL.
// Кнопка «Обновить» на дашборде форсит свежие данные (bypass). При отключении
// интеграции кэш проекта чистим (clearStatsCache). In-memory: живёт в рамках
// инстанса; для мульти-инстанса можно перенести в БД/Redis (пока не нужно).
const STATS_TTL_MS = 15 * 60 * 1000; // 15 минут — аналитика меняется медленно
const STATS_CACHE_MAX = 500; // грубый потолок против роста Map
type CachedStats = { at: number; data: YouTubeData };
const statsCache = new Map<string, CachedStats>();

export function statsCacheKey(conversationId: string, days: number): string {
  return `${conversationId}:${days}`;
}

export function getCachedStats(key: string): YouTubeData | null {
  const c = statsCache.get(key);
  if (!c) return null;
  if (Date.now() - c.at >= STATS_TTL_MS) {
    statsCache.delete(key);
    return null;
  }
  return c.data;
}

export function setCachedStats(key: string, data: YouTubeData): void {
  // Ленивая уборка протухших при разрастании Map.
  if (statsCache.size >= STATS_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of Array.from(statsCache.entries())) {
      if (now - v.at >= STATS_TTL_MS) statsCache.delete(k);
    }
  }
  statsCache.set(key, { at: Date.now(), data });
}

// Сбросить кэш всех периодов проекта (при отключении/переподключении интеграции).
export function clearStatsCache(conversationId: string): void {
  const prefix = `${conversationId}:`;
  for (const k of Array.from(statsCache.keys())) {
    if (k.startsWith(prefix)) statsCache.delete(k);
  }
  snapshotCache.delete(conversationId); // и снимок для чата
}

// ── Снимок канала для контекста ассистента (чат) ──────────────────────────────
// Компактная выжимка (не весь дашборд): канал + KPI за 28 дней с трендом + топ-видео
// с удержанием + источники трафика + драйверы подписчиков. Подставляется в промпт,
// чтобы нейронка разбирала канал предметно. Отдельный кэш (TTL 30 мин) по проекту —
// чтобы НЕ дёргать YouTube на каждое сообщение. Легче дашборда: без таймлайна и
// аудитории. Ошибки best-effort: что не пришло — опускаем.
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
type CachedSnapshot = { at: number; data: ChannelSnapshot };
const snapshotCache = new Map<string, CachedSnapshot>();

async function fetchChannelSnapshot(accessToken: string): Promise<ChannelSnapshot | null> {
  const channel = await fetchChannelInfo(accessToken);
  if (!channel) return null;
  const { current, previous } = periodRanges(28);

  const [videosPage, curSummary, prevSummary, traffic, subVideos] = await Promise.all([
    channel.uploadsPlaylistId
      ? fetchRecentVideosWithAnalytics(accessToken, channel.uploadsPlaylistId, 6)
      : Promise.resolve<VideoPage>({ videos: [], nextPageToken: null }),
    fetchPeriodSummary(accessToken, current.start, current.end),
    fetchPeriodSummary(accessToken, previous.start, previous.end),
    fetchTrafficSources(accessToken, current.start, current.end),
    fetchSubscriberVideos(accessToken, current.start, current.end),
  ]);
  const videos = videosPage.videos;

  const period: ChannelSnapshot["period"] = curSummary
    ? {
        days: 28,
        views: curSummary.views,
        minutes: curSummary.minutes,
        subscribersNet: curSummary.netSubscribers,
        avgRetention: curSummary.avgViewPercentage,
        prevViews: prevSummary?.views ?? null,
        prevSubscribersNet: prevSummary?.netSubscribers ?? null,
        prevAvgRetention: prevSummary?.avgViewPercentage ?? null,
      }
    : null;

  return {
    title: channel.title,
    subscribers: channel.subscriberCount,
    totalViews: channel.viewCount,
    videoCount: channel.videoCount,
    period,
    topVideos: videos.slice(0, 6).map((v) => ({
      title: v.title,
      views: v.viewCount,
      retention: v.avgViewPercentage ?? null,
      publishedAt: v.publishedAt,
    })),
    traffic: (traffic ?? []).slice(0, 4).map((t) => {
      const total = (traffic ?? []).reduce((s, x) => s + x.views, 0) || 1;
      return { label: t.label, pct: Math.round((t.views / total) * 100) };
    }),
    subscriberDrivers: subVideos.slice(0, 3).map((v) => ({ title: v.title, net: v.net })),
  };
}

// Снимок канала проекта для чата: из кэша (TTL 30 мин) или свежий. Токен обновляем
// при необходимости. Любая ошибка (нет прав/протух токен/сбой API) → null: чат
// продолжается без данных канала, не падает.
export async function getChannelSnapshotCached(
  conversationId: string,
  integ: YouTubeIntegration
): Promise<ChannelSnapshot | null> {
  const cached = snapshotCache.get(conversationId);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.data;
  try {
    const accessToken = await getValidAccessToken(integ);
    const snap = await fetchChannelSnapshot(accessToken);
    if (snap) snapshotCache.set(conversationId, { at: Date.now(), data: snap });
    return snap ?? cached?.data ?? null;
  } catch {
    return cached?.data ?? null; // отдаём протухший снимок, если был, иначе ничего
  }
}

// ── Authorize / токены ──────────────────────────────────────────────────────

export function buildYouTubeAuthUrl(state: string): string {
  const creds = googleCreds();
  if (!creds) throw new Error("youtube_not_configured");
  const p = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: youtubeRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + prompt=consent → Google отдаёт refresh_token (нужен для обновления).
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const creds = googleCreds();
  if (!creds) throw new Error("youtube_not_configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: youtubeRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`token_exchange_failed ${res.status} ${body.slice(0, 400)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const creds = googleCreds();
  if (!creds) throw new Error("youtube_not_configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("token_refresh_failed");
  return (await res.json()) as TokenResponse;
}

// Действующий access_token: если истёк (с запасом 60с) — обновляем по refresh_token
// и сохраняем новый в БД. Бросает "no_refresh_token"/"token_refresh_failed", если
// обновить нельзя (нет refresh или Google его отозвал) → UI просит переподключить.
export async function getValidAccessToken(integ: YouTubeIntegration): Promise<string> {
  const stillValid = integ.tokenExpiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) return integ.accessToken;
  if (!integ.refreshToken) throw new Error("no_refresh_token");
  const t = await refreshAccessToken(integ.refreshToken);
  const tokenExpiresAt = new Date(Date.now() + t.expires_in * 1000);
  await prisma.youTubeIntegration.update({
    where: { id: integ.id },
    data: { accessToken: t.access_token, tokenExpiresAt },
  });
  return t.access_token;
}

// Best-effort отзыв токена в Google при отключении интеграции (не критично).
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    /* игнорируем — запись из БД всё равно удалим */
  }
}

// ── YouTube API ─────────────────────────────────────────────────────────────

type Thumb = { url?: string };
interface Thumbnails {
  default?: Thumb;
  medium?: Thumb;
  high?: Thumb;
  standard?: Thumb;
  maxres?: Thumb;
}

function pickThumb(t?: Thumbnails): string | null {
  if (!t) return null;
  return t.high?.url ?? t.medium?.url ?? t.standard?.url ?? t.default?.url ?? null;
}

// Таймаут одного вызова YouTube API — чтобы зависшее соединение не блокировало
// дашборд/снимок канала бесконечно (без него fetch на мёртвом сокете висит вечно).
const YT_FETCH_TIMEOUT_MS = 10_000;

// GET к API YouTube с Bearer-токеном. На не-2xx бросает ошибку с .status (401/403
// = токен протух/отозван → переподключение). По таймауту — AbortError (ловится
// best-effort-обёртками, вернут null/[]; на дашборде — обычная ошибка загрузки).
async function ytGet<T>(url: string, accessToken: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), YT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`youtube_api_${res.status} ${body.slice(0, 400)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface ChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      thumbnails?: Thumbnails;
    };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
    brandingSettings?: { image?: { bannerExternalUrl?: string } };
  }>;
}

export async function fetchChannelInfo(accessToken: string): Promise<YouTubeChannelInfo | null> {
  const data = await ytGet<ChannelsResponse>(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails,brandingSettings&mine=true",
    accessToken
  );
  const item = data.items?.[0];
  if (!item) return null;
  const s = item.snippet ?? {};
  const st = item.statistics ?? {};
  return {
    channelId: item.id,
    title: s.title ?? "Мой канал",
    description: s.description ?? "",
    thumbnail: pickThumb(s.thumbnails),
    banner: item.brandingSettings?.image?.bannerExternalUrl ?? null,
    customUrl: s.customUrl ?? null,
    subscriberCount: Number(st.subscriberCount ?? 0),
    viewCount: Number(st.viewCount ?? 0),
    videoCount: Number(st.videoCount ?? 0),
    hiddenSubscriberCount: Boolean(st.hiddenSubscriberCount),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

interface PlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
  nextPageToken?: string;
}
interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      tags?: string[];
      publishedAt?: string;
      thumbnails?: Thumbnails;
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }>;
}

// Полные данные одного видео (для ИИ-разбора): название, описание, теги, метрики.
export interface VideoFull {
  title: string;
  description: string;
  tags: string[];
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  publishedAt: string;
}

export async function fetchVideoFull(
  accessToken: string,
  videoId: string
): Promise<VideoFull | null> {
  const vd = await ytGet<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(
      videoId
    )}`,
    accessToken
  );
  const v = vd.items?.[0];
  if (!v) return null;
  const s = v.snippet ?? {};
  const st = v.statistics ?? {};
  return {
    title: s.title ?? "",
    description: s.description ?? "",
    tags: s.tags ?? [],
    viewCount: Number(st.viewCount ?? 0),
    likeCount: Number(st.likeCount ?? 0),
    commentCount: Number(st.commentCount ?? 0),
    duration: v.contentDetails?.duration ?? "",
    publishedAt: s.publishedAt ?? "",
  };
}

// Последние N видео канала (через плейлист загрузок) + их статистика.
// Страница видео канала (через плейлист загрузок) + их статистика. pageToken —
// курсор для подгрузки следующих страниц (все ролики, а не только первые). Отдаём
// nextPageToken (null — дальше нет). maxResults у playlistItems максимум 50.
export async function fetchRecentVideos(
  accessToken: string,
  uploadsPlaylistId: string,
  max = 12,
  pageToken?: string
): Promise<VideoPage> {
  const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
  const pl = await ytGet<PlaylistItemsResponse>(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${max}&playlistId=${encodeURIComponent(
      uploadsPlaylistId
    )}${tokenParam}`,
    accessToken
  );
  const nextPageToken = pl.nextPageToken ?? null;
  const ids = (pl.items ?? [])
    .map((it) => it.contentDetails?.videoId)
    .filter((v): v is string => Boolean(v));
  if (ids.length === 0) return { videos: [], nextPageToken };

  const vd = await ytGet<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`,
    accessToken
  );
  const videos = (vd.items ?? []).map((v) => {
    const s = v.snippet ?? {};
    const st = v.statistics ?? {};
    return {
      id: v.id,
      title: s.title ?? "",
      thumbnail: pickThumb(s.thumbnails),
      publishedAt: s.publishedAt ?? "",
      duration: v.contentDetails?.duration ?? "",
      viewCount: Number(st.viewCount ?? 0),
      likeCount: Number(st.likeCount ?? 0),
      commentCount: Number(st.commentCount ?? 0),
    };
  });
  return { videos, nextPageToken };
}

interface AnalyticsResponse {
  rows?: Array<Array<string | number>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Границы текущего окна (последние `days` дней) и предыдущего равного ему —
// для сравнения роста. Даты в формате YYYY-MM-DD (как ждёт Analytics API).
export function periodRanges(days: number): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
} {
  const end = new Date();
  const curStart = new Date(end.getTime() - (days - 1) * DAY_MS);
  const prevEnd = new Date(curStart.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY_MS);
  return {
    current: { start: ymd(curStart), end: ymd(end) },
    previous: { start: ymd(prevStart), end: ymd(prevEnd) },
  };
}

// Временной ряд аналитики за окно [startDate, endDate] (просмотры/минуты/подписчики).
// Требует scope yt-analytics.readonly. При любой ошибке возвращает null — график
// на дашборде просто не рисуем (частая причина: у канала нет доступа к аналитике).
export async function fetchDailyAnalytics(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<DailyPoint[] | null> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
      dimensions: "day",
      sort: "day",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    return (data.rows ?? []).map((r) => ({
      date: String(r[0]),
      views: Number(r[1] ?? 0),
      minutes: Number(r[2] ?? 0),
      subscribersGained: Number(r[3] ?? 0),
      subscribersLost: Number(r[4] ?? 0),
    }));
  } catch {
    return null;
  }
}

// Аналитика по конкретным видео за всё время (удержание/ср. досмотр/время просмотра).
// dimensions=video + filters=video==id1,id2,... Возвращает запись id → метрики.
// best-effort: при ошибке пусто (карточки покажут только лайфтайм-счётчики Data API).
export async function fetchVideoAnalytics(
  accessToken: string,
  videoIds: string[]
): Promise<Record<string, { avgViewPercentage: number; avgViewDuration: number; watchMinutes: number }>> {
  if (videoIds.length === 0) return {};
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate: "2005-02-14", // старт YouTube — по факту клампится к первым данным
      endDate: ymd(new Date()),
      metrics: "estimatedMinutesWatched,averageViewPercentage,averageViewDuration",
      dimensions: "video",
      filters: `video==${videoIds.join(",")}`,
      maxResults: "200",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const out: Record<string, { avgViewPercentage: number; avgViewDuration: number; watchMinutes: number }> = {};
    for (const r of data.rows ?? []) {
      out[String(r[0])] = {
        watchMinutes: Number(r[1] ?? 0),
        avgViewPercentage: Number(r[2] ?? 0),
        avgViewDuration: Number(r[3] ?? 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}

// Последние видео + их аналитика (удержание/ср. досмотр) одним вызовом. Аналитика
// best-effort: если недоступна, вернём видео с одними лайфтайм-счётчиками.
export async function fetchRecentVideosWithAnalytics(
  accessToken: string,
  uploadsPlaylistId: string,
  max = 12,
  pageToken?: string
): Promise<VideoPage> {
  const { videos, nextPageToken } = await fetchRecentVideos(
    accessToken,
    uploadsPlaylistId,
    max,
    pageToken
  );
  if (videos.length === 0) return { videos, nextPageToken };
  const analytics = await fetchVideoAnalytics(accessToken, videos.map((v) => v.id));
  const withAnalytics = videos.map((v) => {
    const a = analytics[v.id];
    return a
      ? {
          ...v,
          avgViewPercentage: a.avgViewPercentage,
          avgViewDuration: a.avgViewDuration,
          watchMinutes: a.watchMinutes,
        }
      : v;
  });
  return { videos: withAnalytics, nextPageToken };
}

// Кривая удержания видео (audience retention): по долям длины ролика — сколько
// зрителей ещё смотрит (audienceWatchRatio) и как это против похожих роликов
// (relativeRetentionPerformance). dimensions=elapsedVideoTimeRatio, фильтр по видео.
// null при ошибке; пустая curve — данных недостаточно (мало просмотров).
// startDate — дата публикации видео (клампится, чтобы окно было не шире ~2 лет:
// запрос retention по 20-летнему диапазону тормозит на порядки, ~23с против ~1с).
export async function fetchVideoRetention(
  accessToken: string,
  videoId: string,
  startDate?: string
): Promise<VideoDetail | null> {
  try {
    // Пол окна — не раньше, чем 2 года назад (нижняя граница ширины запроса).
    const floor = ymd(new Date(Date.now() - 730 * DAY_MS));
    const start = startDate && startDate > floor ? startDate : floor;
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: ymd(new Date()),
      metrics: "audienceWatchRatio,relativeRetentionPerformance",
      dimensions: "elapsedVideoTimeRatio",
      filters: `video==${videoId}`,
      sort: "elapsedVideoTimeRatio",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const curve = (data.rows ?? []).map((r) => ({
      ratio: Number(r[0]),
      watchRatio: Number(r[1] ?? 0),
      relative: Number(r[2] ?? 0),
    }));
    const rels = curve.map((c) => c.relative).filter((n) => Number.isFinite(n) && n > 0);
    const avgRelative = rels.length ? rels.reduce((a, b) => a + b, 0) / rels.length : null;
    return { videoId, curve, avgRelative };
  } catch {
    return null;
  }
}

// Заголовки/превью для набора videoId (videos.list) — для видео-драйверов
// подписчиков (они могут быть не из последних 12). Пусто при ошибке.
async function fetchVideoSnippets(
  accessToken: string,
  ids: string[]
): Promise<Record<string, { title: string; thumbnail: string | null }>> {
  if (ids.length === 0) return {};
  const vd = await ytGet<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}`,
    accessToken
  );
  const out: Record<string, { title: string; thumbnail: string | null }> = {};
  for (const v of vd.items ?? []) {
    out[v.id] = { title: v.snippet?.title ?? "Видео", thumbnail: pickThumb(v.snippet?.thumbnails) };
  }
  return out;
}

// Видео, которые принесли/увели больше всего подписчиков за период (dimensions=
// video). Возвращаем топ по приросту с заголовками/превью, отсортированные по net.
export async function fetchSubscriberVideos(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<SubscriberVideo[]> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "subscribersGained,subscribersLost",
      dimensions: "video",
      sort: "-subscribersGained",
      maxResults: "10",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const rows = (data.rows ?? [])
      .map((r) => ({ id: String(r[0]), gained: Number(r[1] ?? 0), lost: Number(r[2] ?? 0) }))
      .filter((r) => r.gained > 0 || r.lost > 0);
    if (rows.length === 0) return [];
    const snippets = await fetchVideoSnippets(accessToken, rows.map((r) => r.id));
    return rows
      .map((r) => ({
        id: r.id,
        title: snippets[r.id]?.title ?? "Видео",
        thumbnail: snippets[r.id]?.thumbnail ?? null,
        gained: r.gained,
        lost: r.lost,
        net: r.gained - r.lost,
      }))
      .sort((a, b) => b.net - a.net);
  } catch {
    return [];
  }
}

// ── Таймлайн роста: прирост подписчиков по видео + релизы по отрезкам времени ──

// Гранулярность отрезков под период: короткие окна — по дням, длинные — крупнее,
// чтобы столбцов было читаемо (~7–28 штук), а не сотни.
function granularityFor(days: number): Granularity {
  if (days <= 28) return "day";
  if (days <= 90) return "week";
  return "month";
}

// Канонический ключ отрезка, в который попадает дата YYYY-MM-DD: сам день, начало
// ISO-недели (понедельник) или YYYY-MM. Даты трактуем в UTC (Analytics API — по дням).
function bucketKeyFor(dateStr: string, gran: Granularity): string {
  if (gran === "day") return dateStr;
  if (gran === "month") return dateStr.slice(0, 7);
  const d = new Date(`${dateStr}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // 0 = понедельник
  return ymd(new Date(d.getTime() - weekday * DAY_MS));
}

// Дневной прирост подписчиков по одному видео (dimensions=day, фильтр по видео).
// Пусто при ошибке — просто не разложим прирост этого ролика по отрезкам.
async function fetchVideoDailySubs(
  accessToken: string,
  videoId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "subscribersGained",
      dimensions: "day",
      filters: `video==${videoId}`,
      sort: "day",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const out: Record<string, number> = {};
    for (const r of data.rows ?? []) out[String(r[0])] = Number(r[1] ?? 0);
    return out;
  } catch {
    return {};
  }
}

// Таймлайн роста канала за период: единая сетка отрезков (день/неделя/месяц) с
// просмотрами и приростом подписчиков, РАЗЛОЖЕННЫМ по видео-драйверам (+ «Другое»),
// плюс какие ролики вышли в каждый отрезок. Переиспользует уже полученные `daily`
// (просмотры + суммарный прирост по каналу), `subVideos` (топ-драйверы за период) и
// `recentVideos` (для дат выхода/релизов) — добавляет только ≤6 лёгких запросов
// дневного ряда по каждому драйверу. null — если дневного ряда нет.
export async function fetchSubscriberTimeline(
  accessToken: string,
  startDate: string,
  endDate: string,
  days: number,
  daily: DailyPoint[],
  subVideos: SubscriberVideo[],
  recentVideos: YouTubeVideo[]
): Promise<SubscriberTimeline | null> {
  if (!daily || daily.length === 0) return null;
  const gran = granularityFor(days);

  // Драйверы: топ-6 по приросту (subVideos отсортированы по net — пересортируем по
  // gained и берём тех, кто реально привёл подписчиков).
  const drivers = [...subVideos]
    .filter((v) => v.gained > 0)
    .sort((a, b) => b.gained - a.gained)
    .slice(0, 6);

  // Дневной ряд прироста по каждому драйверу — параллельно.
  const dayMaps = await Promise.all(
    drivers.map((v) => fetchVideoDailySubs(accessToken, v.id, startDate, endDate))
  );

  // Каркас отрезков в порядке дней (просмотры + суммарный прирост канала).
  const order: string[] = [];
  const buckets = new Map<string, SubscriberTimelineBucket>();
  const ensure = (key: string): SubscriberTimelineBucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, views: 0, totalGained: 0, gainedByVideo: {}, other: 0, releases: [] };
      buckets.set(key, b);
      order.push(key);
    }
    return b;
  };
  for (const dp of daily) {
    const b = ensure(bucketKeyFor(dp.date, gran));
    b.views += dp.views;
    b.totalGained += dp.subscribersGained;
  }

  // Разложить прирост по драйверам и посчитать суммарный вклад каждого.
  const driverTotal = new Map<string, number>();
  drivers.forEach((v, i) => {
    for (const [date, gained] of Object.entries(dayMaps[i])) {
      if (gained <= 0) continue;
      const b = buckets.get(bucketKeyFor(date, gran));
      if (!b) continue;
      b.gainedByVideo[v.id] = (b.gainedByVideo[v.id] ?? 0) + gained;
      driverTotal.set(v.id, (driverTotal.get(v.id) ?? 0) + gained);
    }
  });

  // «Другое» = прирост отрезка минус то, что отнесли к драйверам (не уходим в минус:
  // дневной ряд по видео и общий канальный ряд считаются чуть по-разному).
  for (const b of Array.from(buckets.values())) {
    const attributed = Object.values(b.gainedByVideo).reduce((s, g) => s + g, 0);
    b.other = Math.max(0, b.totalGained - attributed);
  }

  // Релизы: ролики из недавних, вышедшие в окне периода, — в свои отрезки.
  const startT = new Date(`${startDate}T00:00:00Z`).getTime();
  const endT = new Date(`${endDate}T23:59:59Z`).getTime();
  const pubById = new Map(recentVideos.map((v) => [v.id, v.publishedAt] as const));
  for (const v of recentVideos) {
    if (!v.publishedAt) continue;
    const t = new Date(v.publishedAt).getTime();
    if (Number.isNaN(t) || t < startT || t > endT) continue;
    const b = buckets.get(bucketKeyFor(v.publishedAt.slice(0, 10), gran));
    if (b) b.releases.push({ id: v.id, title: v.title, thumbnail: v.thumbnail });
  }

  const videos: SubscriberTimelineVideo[] = drivers
    .map((v) => ({
      id: v.id,
      title: v.title,
      thumbnail: v.thumbnail,
      gained: driverTotal.get(v.id) ?? 0,
      publishedAt: pubById.get(v.id) ?? null,
    }))
    .filter((v) => v.gained > 0)
    .sort((a, b) => b.gained - a.gained);

  return { granularity: gran, buckets: order.map((k) => buckets.get(k)!), videos };
}

// ── Аудитория (демография/гео/устройства) ────────────────────────────────────

function ageLabel(code: string): string {
  const m = /^age(\d+)-(\d*)$/.exec(code);
  if (!m) return code.replace(/^age/, "");
  return m[2] ? `${m[1]}–${m[2]}` : `${m[1]}+`;
}
function genderLabel(code: string): string {
  const c = code.toLowerCase();
  if (c === "female") return "Женщины";
  if (c === "male") return "Мужчины";
  return "Другое";
}
const DEVICE_LABELS: Record<string, string> = {
  MOBILE: "Телефон",
  DESKTOP: "Десктоп",
  TABLET: "Планшет",
  TV: "Телевизор",
  GAME_CONSOLE: "Консоль",
  UNKNOWN_PLATFORM: "Другое",
};
const COUNTRY_LABELS: Record<string, string> = {
  RU: "Россия",
  UA: "Украина",
  KZ: "Казахстан",
  BY: "Беларусь",
  US: "США",
  DE: "Германия",
  IL: "Израиль",
  UZ: "Узбекистан",
  KG: "Киргизия",
  AM: "Армения",
  AZ: "Азербайджан",
  GE: "Грузия",
  MD: "Молдова",
  LV: "Латвия",
  LT: "Литва",
  EE: "Эстония",
  PL: "Польша",
  GB: "Великобритания",
  CA: "Канада",
  TR: "Турция",
  FR: "Франция",
  IT: "Италия",
  ES: "Испания",
  TJ: "Таджикистан",
  TM: "Туркмения",
};

interface Bucket {
  code: string;
  label: string;
  views: number;
  pct: number;
}
function toBuckets(
  rows: Array<Array<string | number>>,
  label: (code: string) => string,
  max = 8
): Bucket[] {
  const items = rows
    .map((r) => ({ code: String(r[0]), views: Number(r[1] ?? 0) }))
    .filter((r) => r.views > 0)
    .sort((a, b) => b.views - a.views);
  const total = items.reduce((s, r) => s + r.views, 0) || 1;
  return items.slice(0, max).map((r) => ({
    code: r.code,
    label: label(r.code),
    views: r.views,
    pct: (r.views / total) * 100,
  }));
}

// Аудитория за период: возраст+пол (viewerPercentage), топ стран и устройства
// (по просмотрам). 3 отчёта параллельно, best-effort. null — если данных нет
// нигде (у маленьких каналов демография скрыта до порога приватности).
export async function fetchAudience(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<AudienceData | null> {
  const report = async (params: Record<string, string>) => {
    try {
      const p = new URLSearchParams({ ids: "channel==MINE", startDate, endDate, ...params });
      const data = await ytGet<AnalyticsResponse>(
        `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
        accessToken
      );
      return data.rows ?? [];
    } catch {
      return [];
    }
  };

  const [demoRows, geoRows, deviceRows] = await Promise.all([
    report({ metrics: "viewerPercentage", dimensions: "ageGroup,gender" }),
    report({ metrics: "views", dimensions: "country", sort: "-views", maxResults: "10" }),
    report({ metrics: "views", dimensions: "deviceType", sort: "-views" }),
  ]);

  // Возраст/пол: суммируем viewerPercentage по нужной оси.
  const ageMap = new Map<string, number>();
  const genderMap = new Map<string, number>();
  for (const r of demoRows) {
    const ag = String(r[0]);
    const gd = String(r[1]);
    const pct = Number(r[2] ?? 0);
    ageMap.set(ag, (ageMap.get(ag) ?? 0) + pct);
    genderMap.set(gd, (genderMap.get(gd) ?? 0) + pct);
  }
  const age = Array.from(ageMap.entries())
    .map(([code, pct]) => ({ group: ageLabel(code), pct }))
    .filter((a) => a.pct > 0)
    .sort((a, b) => a.group.localeCompare(b.group));
  const gender = Array.from(genderMap.entries())
    .map(([code, pct]) => ({ label: genderLabel(code), pct }))
    .filter((g) => g.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  const geo = toBuckets(geoRows, (c) => COUNTRY_LABELS[c] ?? c, 8).map(
    ({ label, views, pct }) => ({ label, views, pct })
  );
  const devices = toBuckets(deviceRows, (c) => DEVICE_LABELS[c] ?? c, 6).map(
    ({ label, views, pct }) => ({ label, views, pct })
  );

  if (age.length === 0 && gender.length === 0 && geo.length === 0 && devices.length === 0) {
    return null;
  }
  return { age, gender, geo, devices };
}

// Русские лейблы источников трафика (insightTrafficSourceType).
const TRAFFIC_LABELS: Record<string, string> = {
  RELATED_VIDEO: "Рекомендованные",
  YT_SEARCH: "Поиск YouTube",
  BROWSE: "Обзор (главная)",
  EXT_URL: "Внешние источники",
  PLAYLIST: "Плейлисты",
  YT_CHANNEL: "Страница канала",
  NOTIFICATION: "Уведомления",
  SUBSCRIBER: "Подписки",
  SHORTS: "Лента Shorts",
  END_SCREEN: "Конечные заставки",
  HASHTAGS: "Хэштеги",
  ADVERTISING: "Реклама",
  NO_LINK_OTHER: "Прямые / прочие",
  NO_LINK_EMBEDDED: "Встроенный плеер",
  YT_OTHER_PAGE: "Другие страницы YouTube",
  ANNOTATION: "Подсказки",
  CAMPAIGN_CARD: "Карточки-кампании",
  SOUND_PAGE: "Страница звука",
  PRODUCT_PAGE: "Страница товара",
  IMMERSIVE: "Immersive",
};

// Источники трафика за окно [startDate, endDate]: откуда пришли просмотры.
// dimensions=insightTrafficSourceType. Возвращаем топ-6 + свёрнутое «Другое».
// null при ошибке. Рекомендованные/Поиск — прокси качества превью/заголовка.
export async function fetchTrafficSources(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<TrafficSource[] | null> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched",
      dimensions: "insightTrafficSourceType",
      sort: "-views",
      maxResults: "25",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const rows: TrafficSource[] = (data.rows ?? [])
      .map((r) => {
        const code = String(r[0]);
        return {
          source: code,
          label: TRAFFIC_LABELS[code] ?? code,
          views: Number(r[1] ?? 0),
          minutes: Number(r[2] ?? 0),
        };
      })
      .filter((r) => r.views > 0)
      .sort((a, b) => b.views - a.views);

    if (rows.length <= 7) return rows;
    const top = rows.slice(0, 6);
    const rest = rows.slice(6);
    const other = rest.reduce(
      (acc, r) => ({ views: acc.views + r.views, minutes: acc.minutes + r.minutes }),
      { views: 0, minutes: 0 }
    );
    return [...top, { source: "__OTHER__", label: "Другое", views: other.views, minutes: other.minutes }];
  } catch {
    return null;
  }
}

// Агрегат метрик за окно [startDate, endDate] БЕЗ разбивки по дням (одна строка):
// просмотры, время просмотра, подписчики +/−, средний % досмотра. Для KPI-дельт.
// null при ошибке/отсутствии данных — карточки покажут «—» без дельты.
export async function fetchPeriodSummary(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<PeriodMetrics | null> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewPercentage",
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const r = data.rows?.[0];
    if (!r) return null;
    const gained = Number(r[2] ?? 0);
    const lost = Number(r[3] ?? 0);
    return {
      views: Number(r[0] ?? 0),
      minutes: Number(r[1] ?? 0),
      subscribersGained: gained,
      subscribersLost: lost,
      netSubscribers: gained - lost,
      avgViewPercentage: Number(r[4] ?? 0),
    };
  } catch {
    return null;
  }
}
