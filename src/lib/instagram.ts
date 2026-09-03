import { prisma } from "./prisma";
import type { IgAccount, IgReel, IgSnapshot } from "./instagram-types";

// ── Интеграция с Instagram (Instagram API with Instagram Login) ──────────────
//
// Отдельно от youtube.ts: там свои токены, свои скоупы и своя аналитика. Общее —
// только принцип: интеграция ПЕР-ПРОЕКТНАЯ (1 проект = 1 аккаунт), токены лежат
// в БД, наружу отдаём готовый снимок.
//
// ⚠️ Берём флоу «Instagram API with Instagram Login», а НЕ через страницу Facebook:
// человеку не нужна привязанная Page, достаточно профессионального аккаунта
// (Business или Creator) — у личного аккаунта insights не отдаются вовсе.
//
// ⚠️ Токен живёт 60 дней и продлевается вызовом ig_refresh_token (продлить можно
// токен не моложе суток). Refresh-токена, как у Google, тут нет: не продлили
// вовремя — человек переподключает аккаунт заново.

// Экран согласия открывает БРАУЗЕР пользователя — ему прокси не нужен.
const AUTH_URL = "https://www.instagram.com/oauth/authorize";

// ⚠️⚠️ Серверные вызовы Meta идут через переменные, а не константами: прод стоит
// в РФ, и api.instagram.com / graph.instagram.com оттуда не открываются вовсе —
// обмен кода падал `TypeError: fetch failed` (undici, сетевой отказ до ответа),
// а человек видел нашу заглушку «нужен профессиональный аккаунт». Та же схема,
// что у Telegram (`TELEGRAM_API_BASE`) и OpenRouter: на зарубежном Caddy-прокси
// два пути `/igapi/*` → api.instagram.com и `/iggraph/*` → graph.instagram.com,
// закрытые по IP прода. Локально переменные не задаём — ходим напрямую.
const TOKEN_BASE = (process.env.INSTAGRAM_API_BASE || "https://api.instagram.com").replace(
  /\/$/,
  ""
);
const TOKEN_URL = `${TOKEN_BASE}/oauth/access_token`;
const GRAPH = (process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com").replace(
  /\/$/,
  ""
);

// Скоупы: профиль и медиа + инсайты + чтение комментариев. Больше не просим —
// лишние разрешения удлиняют ревью приложения в Meta и пугают человека на экране
// согласия. ⚠️ manage_comments нужен ТОЛЬКО ради чтения текста комментариев под
// своими рилсами (блок «О чём спрашивают зрители»): отвечать/удалять/скрывать мы
// не умеем и в ревью этого не заявляем. Число комментариев приходит и без него
// (метрика `comments` в insights).
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
].join(",");

const LONG_LIVED_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export function instagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/api/integrations/instagram/callback`;
}

export function instagramAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

interface ShortLivedToken {
  access_token: string;
  user_id: string;
}

/** Код с экрана согласия → короткий токен (1 час) → длинный (60 дней). */
export async function exchangeCode(
  code: string
): Promise<{ token: string; userId: string; expiresAt: Date }> {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });

  const short = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Instagram: обмен кода не удался (${r.status})`);
    return (await r.json()) as ShortLivedToken;
  });

  const long = await fetch(
    `${GRAPH}/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(process.env.INSTAGRAM_APP_SECRET ?? "")}` +
      `&access_token=${encodeURIComponent(short.access_token)}`
  ).then(async (r) => {
    if (!r.ok) throw new Error(`Instagram: не удалось продлить токен (${r.status})`);
    return (await r.json()) as { access_token: string; expires_in?: number };
  });

  const ttl = (long.expires_in ?? 0) * 1000 || LONG_LIVED_TTL_MS;
  return {
    token: long.access_token,
    userId: String(short.user_id),
    expiresAt: new Date(Date.now() + ttl),
  };
}

/**
 * Действующий токен проекта. Токен старше суток и ближе недели к истечению —
 * продлеваем: у Instagram нет refresh-токена, и просроченный означает повторное
 * подключение руками.
 */
export async function getValidToken(conversationId: string): Promise<string | null> {
  const row = await prisma.instagramIntegration.findUnique({ where: { conversationId } });
  if (!row) return null;

  const left = row.tokenExpiresAt.getTime() - Date.now();
  if (left > 7 * 24 * 60 * 60 * 1000) return row.accessToken;
  if (left <= 0) return null; // протух — только переподключение

  try {
    const res = await fetch(
      `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token` +
        `&access_token=${encodeURIComponent(row.accessToken)}`
    );
    if (!res.ok) return row.accessToken; // не вышло — работаем старым, пока жив
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const ttl = (data.expires_in ?? 0) * 1000 || LONG_LIVED_TTL_MS;
    await prisma.instagramIntegration.update({
      where: { conversationId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + ttl),
      },
    });
    return data.access_token;
  } catch (err) {
    console.error("[instagram] продление токена:", err);
    return row.accessToken;
  }
}

/** Протухший/отозванный доступ — UI по этому просит переподключить аккаунт. */
export class IgReauthError extends Error {
  constructor() {
    super("Доступ к Instagram истёк — подключите аккаунт заново");
    this.name = "IgReauthError";
  }
}

async function igGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 400 || res.status === 401) throw new IgReauthError();
  if (!res.ok) throw new Error(`Instagram API ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchAccount(token: string): Promise<IgAccount> {
  const data = await igGet<{
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
  }>(
    `${GRAPH}/me?fields=id,username,name,profile_picture_url,followers_count,media_count` +
      `&access_token=${encodeURIComponent(token)}`
  );
  return {
    id: data.id,
    username: data.username ?? "",
    name: data.name ?? data.username ?? "",
    profilePicture: data.profile_picture_url ?? null,
    followers: Number(data.followers_count ?? 0),
    mediaCount: Number(data.media_count ?? 0),
  };
}

// Метрики рилса. ⚠️ Их нужно перечислять ЯВНО: поля, которых нет в запросе, в
// ответе не появятся, даже если аккаунт им соответствует.
const REEL_METRICS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "reels_skip_rate",
].join(",");

interface MediaItem {
  id: string;
  caption?: string;
  media_product_type?: string;
  media_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
}

/**
 * Рилсы аккаунта за период + их метрики.
 *
 * ⚠️ Инсайты берутся ОТДЕЛЬНЫМ запросом на каждый рилс — пакетно Graph их не
 * отдаёт. Поэтому ограничиваем окно и число: аналитика по 30 рилсам — это 31
 * запрос, и на большем объёме мы упрёмся в rate limit приложения.
 */
export async function fetchReels(
  token: string,
  periodDays: number,
  limit = 30
): Promise<IgReel[]> {
  const since = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const media = await igGet<{ data?: MediaItem[] }>(
    `${GRAPH}/me/media?fields=id,caption,media_product_type,media_type,permalink,thumbnail_url,media_url,timestamp` +
      `&limit=50&access_token=${encodeURIComponent(token)}`
  );

  const reels = (media.data ?? [])
    .filter((m) => m.media_product_type === "REELS")
    .filter((m) => (m.timestamp ? new Date(m.timestamp).getTime() >= since : false))
    .slice(0, limit);

  const out: IgReel[] = [];
  for (const m of reels) {
    // Метрики best-effort: у свежего рилса с малым охватом Meta не отдаёт часть
    // полей вовсе — это не ошибка, просто «пока не знаем».
    const values = await fetchReelInsights(token, m.id).catch((err) => {
      if (err instanceof IgReauthError) throw err;
      console.error("[instagram] метрики рилса", m.id, err);
      return {} as Record<string, number>;
    });

    out.push({
      id: m.id,
      caption: (m.caption ?? "").slice(0, 300),
      permalink: m.permalink ?? "",
      thumbnail: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp ?? "",
      duration: null, // ⚠️ длительности в media нет — считаем удержание только там, где она известна
      views: num(values.views),
      reach: num(values.reach),
      likes: num(values.likes),
      comments: num(values.comments),
      shares: num(values.shares),
      saved: num(values.saved),
      // API отдаёт миллисекунды — наружу выносим секунды, ими человек и мыслит.
      avgWatchTime: values.ig_reels_avg_watch_time != null
        ? values.ig_reels_avg_watch_time / 1000
        : null,
      // Доля пропусков приходит долей (0..1) — приводим к процентам.
      skipRate: values.reels_skip_rate != null ? values.reels_skip_rate * 100 : null,
    });
  }
  return out;
}

/**
 * Последние рилсы БЕЗ метрик — один запрос на всё. Для обхода комментариев
 * insights не нужны, а fetchReels делает по запросу на рилс.
 */
export async function fetchRecentReelsLite(
  token: string,
  limit = 10
): Promise<Array<{ id: string; caption: string }>> {
  const media = await igGet<{ data?: MediaItem[] }>(
    `${GRAPH}/me/media?fields=id,caption,media_product_type,timestamp` +
      `&limit=50&access_token=${encodeURIComponent(token)}`
  );
  return (media.data ?? [])
    .filter((m) => m.media_product_type === "REELS")
    .slice(0, limit)
    .map((m) => ({ id: m.id, caption: (m.caption ?? "").slice(0, 300) }));
}

export interface IgComment {
  text: string;
  likes: number;
}

/**
 * Комментарии под рилсом (скоуп instagram_business_manage_comments).
 *
 * ⚠️ Читаем только верхний уровень: ответы — это, как правило, автор отвечает,
 * а нам нужны вопросы зрителей. Порядок — как отдаёт API (свежие первыми);
 * «по релевантности», как у YouTube, тут нет.
 */
export async function fetchReelComments(
  token: string,
  mediaId: string,
  limit = 50
): Promise<IgComment[]> {
  const data = await igGet<{
    data?: Array<{ text?: string; like_count?: number; hidden?: boolean }>;
  }>(
    `${GRAPH}/${mediaId}/comments?fields=text,like_count,hidden` +
      `&limit=${limit}&access_token=${encodeURIComponent(token)}`
  );
  return (data.data ?? [])
    .filter((c) => c.text && !c.hidden)
    .map((c) => ({ text: c.text ?? "", likes: Number(c.like_count ?? 0) }));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchReelInsights(
  token: string,
  mediaId: string
): Promise<Record<string, number>> {
  const data = await igGet<{
    data?: Array<{ name: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>;
  }>(
    `${GRAPH}/${mediaId}/insights?metric=${REEL_METRICS}&access_token=${encodeURIComponent(token)}`
  );
  const out: Record<string, number> = {};
  for (const row of data.data ?? []) {
    const v = row.total_value?.value ?? row.values?.[0]?.value;
    if (typeof v === "number") out[row.name] = v;
  }
  return out;
}

// Снимок для раздела «Аналитика». Кэш в памяти на 15 минут — как у YouTube:
// у Instagram лимит запросов на приложение, а не на пользователя, и раздел,
// который перезапрашивает всё на каждый заход, съест его на десятке клиентов.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; data: IgSnapshot }>();

export async function fetchInstagramSnapshot(
  conversationId: string,
  periodDays: number,
  force = false
): Promise<IgSnapshot | null> {
  const key = `${conversationId}|${periodDays}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const token = await getValidToken(conversationId);
  if (!token) return null;

  const [account, reels] = await Promise.all([
    fetchAccount(token),
    fetchReels(token, periodDays),
  ]);

  const data: IgSnapshot = {
    account,
    reels,
    periodDays,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function clearInstagramCache(conversationId: string): void {
  Array.from(cache.keys()).forEach((k) => {
    if (k.startsWith(`${conversationId}|`)) cache.delete(k);
  });
}

/** Проект принадлежит юзеру? (тот же приём, что assertOwnedProject у YouTube). */
export async function assertOwnedProject(
  userId: string,
  projectId: string
): Promise<string | null> {
  if (!projectId) return null;
  const row = await prisma.conversation.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return row?.id ?? null;
}
