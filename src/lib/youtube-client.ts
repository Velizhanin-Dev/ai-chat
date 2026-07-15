import type {
  YouTubeStatus,
  YouTubeData,
  VideoDetail,
  VideoAnalysis,
  VideoPage,
} from "./youtube-types";

// ── Клиентские обёртки над /api/integrations/youtube/* ──────────────────────

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

// Интеграция пер-проектная — все вызовы несут projectId (id проекта/диалога).
const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

export async function apiYouTubeStatus(projectId: string): Promise<Result<YouTubeStatus>> {
  try {
    const res = await fetch(`/api/integrations/youtube?${q(projectId)}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "Не удалось проверить подключение" };
    return { ok: true, data: (await res.json()) as YouTubeStatus };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiYouTubeDisconnect(projectId: string): Promise<Result<null>> {
  try {
    const res = await fetch(`/api/integrations/youtube?${q(projectId)}`, { method: "DELETE" });
    if (!res.ok) return { ok: false, error: "Не удалось отключить" };
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiYouTubeData(
  projectId: string,
  period: number,
  refresh = false
): Promise<Result<YouTubeData>> {
  try {
    const res = await fetch(
      `/api/integrations/youtube/data?${q(projectId)}&period=${period}${refresh ? "&refresh=1" : ""}`,
      { cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as YouTubeData & {
      error?: string;
      code?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || "Не удалось загрузить данные", code: data.code };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Следующая страница видео канала (для «показать ещё» / бесконечного скролла).
export async function apiYouTubeVideos(
  projectId: string,
  pageToken: string
): Promise<Result<VideoPage>> {
  try {
    const res = await fetch(
      `/api/integrations/youtube/videos?${q(projectId)}&pageToken=${encodeURIComponent(pageToken)}`,
      { cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as VideoPage & {
      error?: string;
      code?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || "Не удалось загрузить видео", code: data.code };
    }
    return { ok: true, data: { videos: data.videos ?? [], nextPageToken: data.nextPageToken ?? null } };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiYouTubeVideoDetail(
  projectId: string,
  videoId: string,
  publishedAt?: string
): Promise<Result<VideoDetail>> {
  try {
    const start = publishedAt ? `&start=${encodeURIComponent(publishedAt.slice(0, 10))}` : "";
    const res = await fetch(
      `/api/integrations/youtube/video?${q(projectId)}&videoId=${encodeURIComponent(videoId)}${start}`,
      { cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as VideoDetail & {
      error?: string;
      code?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || "Не удалось загрузить видео", code: data.code };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Клиентский кэш деталей видео (кривая удержания) — чтобы предзагружать по ховеру
// и мгновенно открывать модалку/повторно открытое видео. Живёт на время вкладки.
// Ошибки НЕ кэшируем (даём повторить). Ключ — projectId:videoId.
const detailCache = new Map<string, Promise<Result<VideoDetail>>>();

export function getVideoDetailCached(
  projectId: string,
  videoId: string,
  publishedAt?: string
): Promise<Result<VideoDetail>> {
  const key = `${projectId}:${videoId}`;
  let p = detailCache.get(key);
  if (!p) {
    p = apiYouTubeVideoDetail(projectId, videoId, publishedAt).then((res) => {
      if (!res.ok) detailCache.delete(key);
      return res;
    });
    detailCache.set(key, p);
  }
  return p;
}

// Предзагрузка (fire-and-forget) — зовём по наведению/фокусу на карточку видео.
export function prefetchVideoDetail(projectId: string, videoId: string, publishedAt?: string): void {
  if (projectId && videoId) void getVideoDetailCached(projectId, videoId, publishedAt);
}

// ИИ-разбор видео (тратит 1 запрос квоты). Возвращает summary + варианты упаковки.
export async function apiAnalyzeVideo(
  projectId: string,
  videoId: string
): Promise<Result<VideoAnalysis>> {
  try {
    const res = await fetch("/api/integrations/youtube/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, videoId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      analysis?: VideoAnalysis;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.analysis) {
      return { ok: false, error: data.error || "Не удалось разобрать видео", code: data.code };
    }
    return { ok: true, data: data.analysis };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Промпт для ассистента «переписать хук» + запись в черновик чата (ключ должен
// совпадать с CHAT_DRAFT_KEY в components/Chat/ChatInput.tsx). После записи —
// навигация на /{projectId}/chat, где ChatInput восстановит черновик.
const CHAT_DRAFT_KEY = "creative-chat:chat-draft-v1";
export function writeHookPrompt(userId: string, videoTitle: string): void {
  const text =
    `Помоги переписать хук (первые 15–30 секунд) для ролика «${videoTitle}». ` +
    `Удержание проседает в начале — нужен более цепляющий заход, чтобы зрители не уходили. ` +
    `Дай 3 варианта сильного хука с учётом методики.`;
  try {
    localStorage.setItem(CHAT_DRAFT_KEY, JSON.stringify({ userId, text }));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

// Ссылка на старт OAuth-подключения (полностраничный редирект). projectId — какой
// проект подключаем; next — куда вернуться после согласия Google (текущая страница).
export function youtubeConnectHref(projectId: string, next: string): string {
  return `/api/integrations/youtube/connect?${q(projectId)}&next=${encodeURIComponent(next)}`;
}

// ── Форматирование ──────────────────────────────────────────────────────────

const compactFmt = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullFmt = new Intl.NumberFormat("ru-RU");

// Компактно: 1,2 тыс. / 3,4 млн (как в YouTube Studio).
export function formatCount(n: number): string {
  return compactFmt.format(n);
}

// Полное число с разделителями (для тултипов): 1 234 567.
export function formatFull(n: number): string {
  return fullFmt.format(n);
}

// ISO8601-длительность → "12:34" или "1:02:03".
export function formatDuration(iso: string): string {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return "";
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const mm = String(min).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ISO8601-длительность → всего секунд (0, если пусто/не распарсилось). Нужна, чтобы
// перевести долю длины ролика (elapsedVideoTimeRatio) в реальные секунды на графике.
export function durationToSeconds(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// Время просмотра: минуты → «12,3 тыс. ч» / «340 ч» / «45 мин».
export function formatWatchTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  return `${compactFmt.format(minutes / 60)} ч`;
}

// Дельта роста в % между текущим и прошлым значением. null — прошлый недоступен
// или был 0 (тогда процент не имеет смысла; UI покажет «новое»/ничего).
export function growthPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// Знаковая строка дельты в процентах: «+12%» / «−4%» / «0%».
export function formatDeltaPct(pct: number): string {
  const rounded = Math.round(pct);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)}%`;
}

// Знаковая строка дельты в процентных пунктах (для «среднего % досмотра»).
export function formatDeltaPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)} п.п.`;
}

// Секунды → «M:SS» / «H:MM:SS» (средняя длительность просмотра).
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

// YYYY-MM-DD → "3 июл" (короткая подпись оси графика).
const shortDateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : shortDateFmt.format(d);
}
