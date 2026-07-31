// Сбор цифр канала под разбор по параметрам органического продвижения.
// Серверный модуль: ходит в YouTube Analytics API и складывает всё в
// ChannelDiagnostics — снимок, который дальше уходит в промпт и сохраняется в
// историю разборов (ChannelAnalysis.metrics).
//
// Принцип: всё best-effort. Любая метрика, которую API не дал, приходит как
// value:null + строка в notes — модель про это честно пишет «данных нет», а не
// придумывает цифру.

import { ytGet, fetchChannelInfo, fetchTrafficSources, periodRanges } from "./youtube";
import { paramsFor } from "./channel-params";
import type {
  ChannelDiagnostics,
  DiagnoseKind,
  DiagnosticsMetric,
  DiagnosticsVideo,
  ParamKey,
} from "./youtube-types";

interface AnalyticsResponse {
  rows?: Array<Array<string | number>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Старт YouTube: Analytics сам клампит окно к первым данным канала, так что это
// безопасная нижняя граница для режима «за всё время».
const YT_EPOCH = "2005-02-14";
// Шортсом считаем ролик не длиннее 3 минут — фолбэк, когда API не разделил
// контент по creatorContentType.
const SHORT_MAX_SEC = 180;
// Сколько роликов берём в разбор и по скольким тянем кривую удержания.
const TOP_VIDEOS = 10;
const RETENTION_PROBES = 5;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ISO8601 (PT12M34S) → секунды.
function isoToSeconds(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// Границы окна разбора. days = 0 → всё время жизни канала.
function diagnoseRange(days: number): { start: string; end: string } {
  const end = ymd(new Date());
  if (days === 0) return { start: YT_EPOCH, end };
  return { start: periodRanges(days).current.start, end };
}

interface Totals {
  views: number;
  minutes: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  avgViewPercentage: number;
  avgViewDuration: number;
}

const EMPTY_TOTALS: Totals = {
  views: 0,
  minutes: 0,
  subscribersGained: 0,
  subscribersLost: 0,
  likes: 0,
  dislikes: 0,
  comments: 0,
  shares: 0,
  avgViewPercentage: 0,
  avgViewDuration: 0,
};

const TOTAL_METRICS =
  "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,dislikes,comments,shares,averageViewPercentage,averageViewDuration";

function rowToTotals(r: Array<string | number>, offset: number): Totals {
  const n = (i: number) => Number(r[i + offset] ?? 0);
  return {
    views: n(0),
    minutes: n(1),
    subscribersGained: n(2),
    subscribersLost: n(3),
    likes: n(4),
    dislikes: n(5),
    comments: n(6),
    shares: n(7),
    avgViewPercentage: n(8),
    avgViewDuration: n(9),
  };
}

// Взвешенное объединение двух срезов (для kind="all": шортсы + лонги).
// Проценты и среднее время взвешиваем по просмотрам, иначе редкий срез перекосит.
function mergeTotals(a: Totals, b: Totals): Totals {
  const views = a.views + b.views;
  const w = (x: number, y: number) =>
    views > 0 ? (x * a.views + y * b.views) / views : (x + y) / 2;
  return {
    views,
    minutes: a.minutes + b.minutes,
    subscribersGained: a.subscribersGained + b.subscribersGained,
    subscribersLost: a.subscribersLost + b.subscribersLost,
    likes: a.likes + b.likes,
    dislikes: a.dislikes + b.dislikes,
    comments: a.comments + b.comments,
    shares: a.shares + b.shares,
    avgViewPercentage: w(a.avgViewPercentage, b.avgViewPercentage),
    avgViewDuration: w(a.avgViewDuration, b.avgViewDuration),
  };
}

interface TotalsBreakdown {
  shorts: Totals | null; // null — API не разделил контент по типу
  long: Totals | null;
  all: Totals;
  split: boolean; // удалось ли разделить шортсы и лонги
}

// Итоги за окно с разбивкой по типу контента (dimensions=creatorContentType).
// Один запрос отдаёт и шортсы, и лонги, и сумму. Если разбивка не поддерживается
// (старые каналы / изменения API) — повторяем без dimensions и помечаем split=false.
async function fetchTotals(
  accessToken: string,
  start: string,
  end: string
): Promise<TotalsBreakdown | null> {
  const base = {
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
    metrics: TOTAL_METRICS,
  };
  try {
    const p = new URLSearchParams({ ...base, dimensions: "creatorContentType" });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const rows = data.rows ?? [];
    if (rows.length === 0) return null;
    let shorts: Totals | null = null;
    let long: Totals | null = null;
    let all: Totals | null = null;
    for (const r of rows) {
      const type = String(r[0]);
      const t = rowToTotals(r, 1);
      if (type === "SHORTS") shorts = shorts ? mergeTotals(shorts, t) : t;
      // Лонгом считаем обычные видео; трансляции и истории туда же — это не шортсы.
      else long = long ? mergeTotals(long, t) : t;
      all = all ? mergeTotals(all, t) : t;
    }
    return { shorts, long, all: all ?? EMPTY_TOTALS, split: true };
  } catch {
    // Фолбэк без разбивки: цифры по каналу целиком.
  }
  try {
    const p = new URLSearchParams(base);
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    const r = data.rows?.[0];
    if (!r) return null;
    const all = rowToTotals(r, 0);
    return { shorts: null, long: null, all, split: false };
  } catch {
    return null;
  }
}

interface VideoRow {
  id: string;
  views: number;
  retention: number | null;
  avgDuration: number | null;
  likes: number;
  comments: number;
}

// Топ роликов окна по просмотрам с их аналитикой (dimensions=video).
async function fetchTopVideos(
  accessToken: string,
  start: string,
  end: string
): Promise<VideoRow[]> {
  try {
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: end,
      metrics: "views,averageViewPercentage,averageViewDuration,likes,comments",
      dimensions: "video",
      sort: "-views",
      maxResults: String(TOP_VIDEOS * 3), // с запасом: часть отсеет фильтр по типу
    });
    const data = await ytGet<AnalyticsResponse>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`,
      accessToken
    );
    return (data.rows ?? []).map((r) => ({
      id: String(r[0]),
      views: Number(r[1] ?? 0),
      retention: Number(r[2] ?? 0) || null,
      avgDuration: Number(r[3] ?? 0) || null,
      likes: Number(r[4] ?? 0),
      comments: Number(r[5] ?? 0),
    }));
  } catch {
    return [];
  }
}

interface Snippet {
  title: string;
  durationSec: number;
  publishedAt: string;
}

async function fetchSnippets(
  accessToken: string,
  ids: string[]
): Promise<Record<string, Snippet>> {
  if (ids.length === 0) return {};
  try {
    const data = await ytGet<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; publishedAt?: string };
        contentDetails?: { duration?: string };
      }>;
    }>(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.join(",")}`,
      accessToken
    );
    const out: Record<string, Snippet> = {};
    for (const v of data.items ?? []) {
      out[v.id] = {
        title: v.snippet?.title ?? "Видео",
        durationSec: isoToSeconds(v.contentDetails?.duration ?? ""),
        publishedAt: v.snippet?.publishedAt ?? "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

// Доля зрителей, оставшихся к каждой из отметок `marks` (в секундах) — по одной
// кривой удержания за запрос. Значение null, если кривой нет (мало просмотров)
// или ролик короче отметки.
async function fetchRetentionAt(
  accessToken: string,
  videoId: string,
  durationSec: number,
  marks: number[],
  publishedAt: string
): Promise<Record<string, number | null>> {
  const empty = Object.fromEntries(marks.map((m) => [String(m), null]));
  if (durationSec <= 0) return empty;
  try {
    const floor = ymd(new Date(Date.now() - 730 * DAY_MS));
    const startDate = publishedAt && publishedAt.slice(0, 10) > floor ? publishedAt.slice(0, 10) : floor;
    const p = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate: ymd(new Date()),
      metrics: "audienceWatchRatio",
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
      watch: Number(r[1] ?? 0),
    }));
    if (curve.length === 0) return empty;
    const out: Record<string, number | null> = {};
    for (const m of marks) {
      if (durationSec <= m) {
        out[String(m)] = null; // ролик короче отметки — мерить нечего
        continue;
      }
      const target = m / durationSec;
      const pt = curve.reduce((best, c) =>
        Math.abs(c.ratio - target) < Math.abs(best.ratio - target) ? c : best
      );
      out[String(m)] = pt.watch * 100;
    }
    return out;
  } catch {
    return empty;
  }
}

// ── Форматирование значений ───────────────────────────────────────────────────

function fmtPct(v: number): string {
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} %`;
}

function fmtSec(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m > 0 ? `${m} мин ${s} с` : `${s} с`;
}

function metric(
  key: ParamKey,
  value: number | null,
  unit: "%" | "sec" | "",
  note?: string
): DiagnosticsMetric {
  const display =
    value == null ? "нет данных" : unit === "%" ? fmtPct(value) : unit === "sec" ? fmtSec(value) : String(Math.round(value));
  return { key, value, display, ...(note ? { note } : {}) };
}

// Доля просмотров, пришедших из «внутренних» источников канала — рекомендаций,
// плейлистов, страницы канала. Прокси параметра «поведение после просмотра»:
// сколько просмотров канал генерит себе сам.
const INTERNAL_SOURCES = new Set(["RELATED_VIDEO", "PLAYLIST", "YT_CHANNEL", "SUBSCRIBER", "END_SCREEN"]);

export interface CollectOptions {
  kind: DiagnoseKind;
  periodDays: number;
  manualCtr: number | null;
}

// Главный сборщик: цифры канала под выбранный срез.
export async function collectDiagnostics(
  accessToken: string,
  opts: CollectOptions
): Promise<ChannelDiagnostics | null> {
  const { kind, periodDays, manualCtr } = opts;
  const { start, end } = diagnoseRange(periodDays);
  const notes: string[] = [];

  const channel = await fetchChannelInfo(accessToken);
  if (!channel) return null;

  const [breakdown, traffic, topRows] = await Promise.all([
    fetchTotals(accessToken, start, end),
    fetchTrafficSources(accessToken, start, end),
    fetchTopVideos(accessToken, start, end),
  ]);

  if (!breakdown) return null;
  if (!breakdown.split && kind !== "all") {
    notes.push(
      "YouTube не отдал разбивку по типу контента — цифры посчитаны по каналу целиком, шортсы и обычные видео вперемешку."
    );
  }

  const totals =
    kind === "shorts"
      ? breakdown.shorts ?? breakdown.all
      : kind === "long"
        ? breakdown.long ?? breakdown.all
        : breakdown.all;

  if (kind === "shorts" && breakdown.split && !breakdown.shorts) {
    notes.push("За выбранный период у канала нет шортсов.");
  }

  // Ролики: подтягиваем заголовки/длительность и фильтруем под срез.
  const snippets = await fetchSnippets(
    accessToken,
    topRows.slice(0, TOP_VIDEOS * 3).map((r) => r.id)
  );
  const isShort = (id: string) => {
    const sec = snippets[id]?.durationSec ?? 0;
    return sec > 0 && sec <= SHORT_MAX_SEC;
  };
  const filtered = topRows
    .filter((r) => (kind === "shorts" ? isShort(r.id) : kind === "long" ? !isShort(r.id) : true))
    .slice(0, TOP_VIDEOS);

  // Кривые удержания — только по нескольким верхним роликам (по запросу на ролик).
  // У шортсов две отметки: 3 секунды (скроллит или залипает) и 30 (шортс теперь
  // бывает до 3 минут — на 30-й отваливается случайный зритель).
  const marks = kind === "shorts" ? [3, 30] : [30];
  const probes = filtered.slice(0, RETENTION_PROBES);
  const early = await Promise.all(
    probes.map((r) =>
      fetchRetentionAt(
        accessToken,
        r.id,
        snippets[r.id]?.durationSec ?? 0,
        marks,
        snippets[r.id]?.publishedAt ?? ""
      )
    )
  );
  const earlyById = new Map<string, Record<string, number | null>>();
  probes.forEach((r, i) => earlyById.set(r.id, early[i]));

  const videos: DiagnosticsVideo[] = filtered.map((r) => ({
    id: r.id,
    title: snippets[r.id]?.title ?? "Видео",
    views: r.views,
    retention: r.retention,
    avgDuration: r.avgDuration,
    durationSec: snippets[r.id]?.durationSec ?? 0,
    retentionAt: earlyById.get(r.id) ?? Object.fromEntries(marks.map((m) => [String(m), null])),
    likes: r.likes,
    comments: r.comments,
    publishedAt: snippets[r.id]?.publishedAt ?? "",
  }));

  // Среднее по отметке: считаем только по роликам, где кривая реально есть.
  const avgAt = (mark: number): { avg: number | null; n: number } => {
    const vals = early
      .map((rec) => rec[String(mark)])
      .filter((v): v is number => v != null);
    return {
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      n: vals.length,
    };
  };
  const first3 = avgAt(3);
  const first30 = avgAt(30);
  const primary = kind === "shorts" ? first3 : first30;
  if (primary.avg == null) {
    notes.push(
      `Кривой удержания нет — по роликам среза не хватает просмотров, чтобы YouTube отдал первые секунды.`
    );
  }
  if (kind === "shorts" && first30.avg == null) {
    notes.push(
      "Удержание на 30-й секунде по шортсам не посчитано: ролики короче 30 секунд или данных по кривой мало."
    );
  }

  // Конверсии считаем от просмотров среза; без просмотров — нет и параметров.
  const v = totals.views;
  const rate = (x: number) => (v > 0 ? (x / v) * 100 : null);

  const trafficViews = (traffic ?? []).reduce((acc, t) => acc + t.views, 0);
  const internalViews = (traffic ?? [])
    .filter((t) => INTERNAL_SOURCES.has(t.source))
    .reduce((acc, t) => acc + t.views, 0);
  const internalShare = trafficViews > 0 ? (internalViews / trafficViews) * 100 : null;
  const searchShare =
    trafficViews > 0
      ? ((traffic ?? []).find((t) => t.source === "YT_SEARCH")?.views ?? 0) / trafficViews * 100
      : null;
  const browseShare =
    trafficViews > 0
      ? ((traffic ?? [])
          .filter((t) => t.source === "BROWSE" || t.source === "RELATED_VIDEO")
          .reduce((acc, t) => acc + t.views, 0) /
          trafficViews) *
        100
      : null;

  if (manualCtr == null) {
    notes.push(
      "CTR превью YouTube по API не отдаёт (он есть только в Studio). Пользователь его не ввёл — оценивай кликабельность косвенно и честно скажи, что точную цифру надо смотреть в Studio."
    );
  }

  const metrics: DiagnosticsMetric[] =
    kind === "shorts"
      ? [
          metric("sFirst3", first3.avg, "%", `среднее по ${first3.n} шортсам с кривой удержания`),
          metric(
            "sFirst30",
            first30.avg,
            "%",
            first30.n
              ? `среднее по ${first30.n} шортсам длиннее 30 секунд`
              : "нет шортсов длиннее 30 секунд с достаточной статистикой"
          ),
          metric("sRetention", totals.avgViewPercentage || null, "%"),
          metric("sLike", rate(totals.likes), "%"),
          metric(
            "sShare",
            rate(totals.shares),
            "%",
            totals.shares === 0 ? "репостов за период не зафиксировано" : undefined
          ),
          metric("sSubscribe", rate(totals.subscribersGained), "%"),
          metric("sComment", rate(totals.comments), "%"),
        ]
      : [
          metric("first30", first30.avg, "%", `среднее по ${first30.n} роликам с кривой удержания`),
          metric("retention", totals.avgViewPercentage || null, "%"),
          metric("avgDuration", totals.avgViewDuration || null, "sec"),
          metric(
            "ctr",
            manualCtr,
            "%",
            manualCtr != null
              ? "цифра введена пользователем из YouTube Studio"
              : `API не отдаёт CTR. Косвенные сигналы: из рекомендаций и главной ${
                  browseShare != null ? fmtPct(browseShare) : "нет данных"
                } трафика, из поиска ${searchShare != null ? fmtPct(searchShare) : "нет данных"}`
          ),
          metric("engagement", rate(totals.likes + totals.dislikes + totals.comments), "%"),
          metric("subscribe", rate(totals.subscribersGained), "%"),
          metric(
            "afterWatch",
            internalShare,
            "%",
            "доля просмотров из внутренних источников канала (рекомендации, плейлисты, страница канала, конечные заставки) — прокси того, идёт ли зритель дальше по каналу"
          ),
        ];

  // Порядок метрик = порядок параметров режима (он же порядок секторов круга).
  const order = paramsFor(kind).map((p) => p.key);
  metrics.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  // Предыдущее равное окно — только для конечных периодов (для «всё время» его нет).
  let prevTotals: ChannelDiagnostics["prevTotals"] = null;
  if (periodDays > 0) {
    const prev = periodRanges(periodDays).previous;
    const prevBreak = await fetchTotals(accessToken, prev.start, prev.end);
    const p =
      prevBreak &&
      (kind === "shorts"
        ? prevBreak.shorts ?? prevBreak.all
        : kind === "long"
          ? prevBreak.long ?? prevBreak.all
          : prevBreak.all);
    if (p) {
      prevTotals = {
        views: p.views,
        avgViewPercentage: p.avgViewPercentage,
        subscribersGained: p.subscribersGained,
      };
    }
  }

  return {
    kind,
    periodDays,
    rangeStart: start,
    rangeEnd: end,
    channel: {
      title: channel.title,
      subscribers: channel.subscriberCount,
      totalViews: channel.viewCount,
      videoCount: channel.videoCount,
    },
    totals,
    prevTotals,
    metrics,
    traffic,
    videos,
    manualCtr,
    notes,
  };
}
