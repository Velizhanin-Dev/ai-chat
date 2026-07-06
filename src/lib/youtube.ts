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

// GET к API YouTube с Bearer-токеном. На не-2xx бросает ошибку с .status (401/403
// = токен протух/отозван → переподключение).
async function ytGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
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
export async function fetchRecentVideos(
  accessToken: string,
  uploadsPlaylistId: string,
  max = 12
): Promise<YouTubeVideo[]> {
  const pl = await ytGet<PlaylistItemsResponse>(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${max}&playlistId=${encodeURIComponent(
      uploadsPlaylistId
    )}`,
    accessToken
  );
  const ids = (pl.items ?? [])
    .map((it) => it.contentDetails?.videoId)
    .filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];

  const vd = await ytGet<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`,
    accessToken
  );
  return (vd.items ?? []).map((v) => {
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
  max = 12
): Promise<YouTubeVideo[]> {
  const videos = await fetchRecentVideos(accessToken, uploadsPlaylistId, max);
  if (videos.length === 0) return videos;
  const analytics = await fetchVideoAnalytics(accessToken, videos.map((v) => v.id));
  return videos.map((v) => {
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
