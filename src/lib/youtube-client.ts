import type {
  YouTubeStatus,
  YouTubeData,
  VideoDetail,
  VideoAnalysis,
  VideoPage,
  ChannelAnalysisRow,
  DiagnoseKind,
} from "./youtube-types";
import type { BriefAutofill } from "./brief";
import type { JobView } from "@/lib/jobs";
import {
  waitForJob,
  rememberJob,
  forgetJob,
  recallJob,
  apiActiveJobs,
} from "@/lib/jobs-client";

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

// Черновое подключение (шаг брифа, проекта ещё нет) — привязано к юзеру, без projectId.
export async function apiYouTubePendingStatus(): Promise<Result<YouTubeStatus>> {
  try {
    const res = await fetch("/api/integrations/youtube/pending", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "Не удалось проверить подключение" };
    return { ok: true, data: (await res.json()) as YouTubeStatus };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiYouTubePendingDisconnect(): Promise<Result<null>> {
  try {
    const res = await fetch("/api/integrations/youtube/pending", { method: "DELETE" });
    if (!res.ok) return { ok: false, error: "Не удалось отключить" };
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Автозаполнение брифа по подключённому каналу. Без projectId — по черновому
// подключению (шаг брифа); с projectId — по каналу существующего проекта.
export async function apiBriefAutofill(projectId?: string): Promise<Result<BriefAutofill>> {
  try {
    const res = await fetch("/api/brief/autofill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectId ? { projectId } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as {
      autofill?: BriefAutofill;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.autofill) {
      return { ok: false, error: data.error || "Не удалось разобрать канал", code: data.code };
    }
    return { ok: true, data: data.autofill };
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

// Период: пресет (число дней) ИЛИ произвольный диапазон из календаря.
export type PeriodSelection = number | { start: string; end: string };

export async function apiYouTubeData(
  projectId: string,
  period: PeriodSelection,
  refresh = false
): Promise<Result<YouTubeData>> {
  try {
    const range =
      typeof period === "number"
        ? `period=${period}`
        : `start=${encodeURIComponent(period.start)}&end=${encodeURIComponent(period.end)}`;
    const res = await fetch(
      `/api/integrations/youtube/data?${q(projectId)}&${range}${refresh ? "&refresh=1" : ""}`,
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
  publishedAt?: string,
  needDuration = false
): Promise<Result<VideoDetail>> {
  try {
    const start = publishedAt ? `&start=${encodeURIComponent(publishedAt.slice(0, 10))}` : "";
    const dur = needDuration ? "&needDuration=1" : "";
    const res = await fetch(
      `/api/integrations/youtube/video?${q(projectId)}&videoId=${encodeURIComponent(videoId)}${start}${dur}`,
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
  publishedAt?: string,
  needDuration = false
): Promise<Result<VideoDetail>> {
  // Ключ разный для запросов с длительностью и без — иначе ответ без duration
  // (предзагрузка по ховеру карточки) переиспользовался бы там, где она нужна.
  const key = `${projectId}:${videoId}${needDuration ? ":d" : ""}`;
  let p = detailCache.get(key);
  if (!p) {
    p = apiYouTubeVideoDetail(projectId, videoId, publishedAt, needDuration).then((res) => {
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
  videoId: string,
  // CTR превью из YouTube Studio (API его не отдаёт); null — не вводили.
  manualCtr?: number | null
): Promise<Result<VideoAnalysis>> {
  try {
    const res = await fetch("/api/integrations/youtube/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, videoId, manualCtr: manualCtr ?? null }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      job?: JobView;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.job) {
      return { ok: false, error: data.error || "Не удалось разобрать видео", code: data.code };
    }
    // Разбор ФОНОВЫЙ: сервер отдал id задачи, считает воркер. Модалка ролика живёт
    // недолго, поэтому тут просто ждём результат; задача при этом переживает уход
    // со страницы — если вернуться, её видно в /api/jobs.
    try {
      const job = await waitForJob(data.job.id);
      if (job.status !== "done") {
        return { ok: false, error: job.error || "Не удалось разобрать видео" };
      }
      return { ok: true, data: (job.result as { analysis: VideoAnalysis }).analysis };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Не удалось разобрать видео" };
    }
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// ── Разбор канала по параметрам продвижения ──────────────────────────────────

// История разборов проекта (свежие сверху). Квоту не тратит.
export async function apiChannelAnalyses(
  projectId: string
): Promise<Result<ChannelAnalysisRow[]>> {
  try {
    const res = await fetch(`/api/integrations/youtube/diagnose?${q(projectId)}`, {
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      analyses?: ChannelAnalysisRow[];
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.analyses) {
      return { ok: false, error: data.error || "Не удалось загрузить разборы", code: data.code };
    }
    return { ok: true, data: data.analyses };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Новый разбор канала — ТРАТИТ 1 запрос квоты. manualCtr — цифра из YouTube Studio
// (API её не отдаёт), null/undefined = не вводили.
export async function apiDiagnoseChannel(args: {
  projectId: string;
  kind: DiagnoseKind;
  periodDays: number;
  manualCtr?: number | null;
}): Promise<Result<ChannelAnalysisRow>> {
  try {
    const res = await fetch("/api/integrations/youtube/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = (await res.json().catch(() => ({}))) as {
      job?: JobView;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.job) {
      return { ok: false, error: data.error || "Не удалось разобрать канал", code: data.code };
    }
    // Разбор ФОНОВЫЙ: сервер отдал id задачи, считает воркер. Ждём результат тут,
    // но задача переживает уход со страницы — вернувшись, её подхватит
    // findPendingDiagnoseJob (см. ниже).
    rememberJob("channel_diagnose", args.projectId, data.job.id);
    try {
      return { ok: true, data: await awaitDiagnoseJob(data.job.id) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Не удалось разобрать канал" };
    } finally {
      forgetJob("channel_diagnose", args.projectId);
    }
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Дождаться готового разбора по id задачи.
export async function awaitDiagnoseJob(jobId: string): Promise<ChannelAnalysisRow> {
  const job = await waitForJob(jobId);
  if (job.status !== "done") throw new Error(job.error || "Не удалось разобрать канал");
  return (job.result as { analysis: ChannelAnalysisRow }).analysis;
}

// Незавершённый разбор канала в этом проекте (после возврата на страницу).
export async function findPendingDiagnoseJob(projectId: string): Promise<string | null> {
  const jobs = await apiActiveJobs({ projectId, kind: "channel_diagnose" });
  return jobs.length ? jobs[0].id : recallJob("channel_diagnose", projectId);
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

// Промпт «слабый CTR — перепиши превью по ВИСП». В отличие от хука, тут важно НЕ
// просить абстрактные варианты, а принести ассистенту РЕАЛЬНЫЕ ролики канала с их
// текущими названиями и цифрами: он разбирает, что не так с существующей упаковкой,
// и переписывает её. Без этого списка ответ был бы общей лекцией про ВИСП.
export function writeThumbTextsPrompt(
  userId: string,
  videos: { title: string; views: number; retention?: number | null }[]
): void {
  // Берём до 8 роликов: больше не нужно (лимит артефактов в ответе всё равно
  // режет), а промпт раздувается.
  const list = videos
    .slice(0, 8)
    .map((v, i) => {
      const ret = v.retention != null ? `, досмотр ${Math.round(v.retention)}%` : "";
      return `${i + 1}. «${v.title}» — ${formatCount(v.views)} просмотров${ret}`;
    })
    .join("\n");

  const text =
    `У меня слабый CTR превью. Разбери упаковку моих реальных роликов и перепиши её.\n\n` +
    `Вот что уже вышло на канале:\n${list}\n\n` +
    `По каждому: скажи коротко, что не так с текущим названием и текстом на превью ` +
    `(что не цепляет, где схлопывается интрига, где превью дублирует название), ` +
    `и дай переписанный вариант — новое название и текст на превью по ВИСП ` +
    `(выгода, интрига, срочность, причастность) с одной из трёх эмоций в будущее: ` +
    `страх, надежда, любопытство. Заходы по роликам должны быть РАЗНЫЕ.`;
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

// Подключение на шаге брифа: проекта ещё нет, токены лягут на юзера (черновик) и
// переедут в проект, когда он создастся в конце брифа.
export function youtubeDraftConnectHref(next: string): string {
  return `/api/integrations/youtube/connect?draft=1&next=${encodeURIComponent(next)}`;
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

// ER в процентах. Значения обычно единицы процентов, поэтому до 2 знаков на
// маленьких и до 1 на крупных — иначе «5%» и «5%» выглядят одинаково при разнице
// в разы. См. engagementRate в youtube-types.ts.
export function formatEr(er: number): string {
  const digits = er < 1 ? 2 : 1;
  return `${er.toFixed(digits).replace(".", ",")}%`;
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
