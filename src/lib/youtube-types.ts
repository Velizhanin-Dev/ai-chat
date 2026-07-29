// Чистые типы интеграции YouTube — БЕЗ импорта prisma/серверных модулей, чтобы их
// можно было тянуть и в клиентские компоненты, и в серверный src/lib/youtube.ts.

// Снимок канала (карточка «подключено» в настройках).
export interface YouTubeChannelBrief {
  channelId: string;
  title: string;
  thumbnail: string | null;
  customUrl: string | null;
}

// Ответ GET /api/integrations/youtube (статус подключения).
export interface YouTubeStatus {
  // Настроены ли Google-ключи на сервере (без них подключать нечем).
  configured: boolean;
  connected: boolean;
  channel: YouTubeChannelBrief | null;
}

// Полная инфа о канале для дашборда «Канал».
export interface YouTubeChannelInfo {
  channelId: string;
  title: string;
  description: string;
  thumbnail: string | null;
  banner: string | null;
  customUrl: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  hiddenSubscriberCount: boolean;
  uploadsPlaylistId: string | null;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  duration: string; // ISO8601, напр. "PT12M34S"
  viewCount: number;
  likeCount: number;
  commentCount: number;
  // Дизлайки: публичного счётчика у YouTube с 2021 нет, но Analytics по своему
  // каналу их отдаёт. undefined = аналитика недоступна (в ER не учитываем).
  dislikeCount?: number;
  // Аналитика видео (best-effort, требует yt-analytics.readonly; может отсутствовать).
  avgViewPercentage?: number; // средний % досмотра (удержание) за всё время
  avgViewDuration?: number; // средняя длительность просмотра, секунды
  watchMinutes?: number; // суммарное время просмотра, минуты
}

// ER (вовлечённость) = действия / просмотры, где действия = лайки + дизлайки +
// комментарии. null — считать не из чего (нет просмотров). Общий помощник:
// используется и на карточке видео, и в модалке разбора.
export function engagementRate(v: {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  dislikeCount?: number;
}): number | null {
  if (!v.viewCount) return null;
  const actions = v.likeCount + (v.dislikeCount ?? 0) + v.commentCount;
  return (actions / v.viewCount) * 100;
}

// Страница видео канала + курсор на следующую (null — дальше нет). Раздел «Канал»
// подгружает все ролики постранично через этот курсор.
export interface VideoPage {
  videos: YouTubeVideo[];
  nextPageToken: string | null;
}

// Точка временного ряда аналитики (день).
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  views: number;
  minutes: number;
  subscribersGained: number;
  subscribersLost: number;
}

// Видео и сколько подписчиков оно принесло/увело за период.
export interface SubscriberVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  gained: number;
  lost: number;
  net: number; // gained - lost
}

// Видео, вышедшее в конкретный отрезок времени (маркер релиза под таймлайном).
export interface TimelineRelease {
  id: string;
  title: string;
  thumbnail: string | null;
}

// Видео-драйвер подписчиков на таймлайне роста: суммарный вклад за период + дата
// выхода. Порядок в массиве = порядок стека столбца и цвета (по убыванию вклада).
export interface SubscriberTimelineVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  gained: number; // сколько подписчиков привёл за период (по дневному ряду)
  publishedAt: string | null;
}

// Один отрезок таймлайна (день/неделя/месяц): просмотры + прирост подписчиков,
// разложенный по видео-драйверам (+ «Другое») + какие ролики вышли в этот отрезок.
export interface SubscriberTimelineBucket {
  key: string; // канонический старт отрезка: YYYY-MM-DD (день/неделя) или YYYY-MM (месяц)
  views: number;
  totalGained: number; // весь прирост за отрезок (из дневного ряда канала)
  gainedByVideo: Record<string, number>; // videoId → сколько привёл в этом отрезке
  other: number; // прирост, не отнесённый к топ-драйверам
  releases: TimelineRelease[]; // ролики, вышедшие в этот отрезок
}

export type Granularity = "day" | "week" | "month";

// Таймлайн роста канала: общие отрезки времени для двух синхронных графиков
// (просмотры + подписчики по видео) + список драйверов для легенды-лидерборда.
export interface SubscriberTimeline {
  granularity: Granularity;
  buckets: SubscriberTimelineBucket[];
  videos: SubscriberTimelineVideo[]; // драйверы по убыванию вклада (= порядок/цвета стека)
}

// Динамика подписчиков за период: по дням (пришло/ушло) + видео-драйверы + таймлайн.
export interface SubscriberDynamics {
  daily: { date: string; gained: number; lost: number }[];
  topVideos: SubscriberVideo[]; // по net-приросту (лидеры сверху)
  // Таймлайн роста (просмотры + прирост по видео + релизы); null — данных мало.
  timeline?: SubscriberTimeline | null;
}

// Допустимые окна периода (дней). 365 подписываем как «год».
export const PERIOD_DAYS = [7, 28, 90, 365] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

// Агрегат метрик за период (без разбивки по дням).
export interface PeriodMetrics {
  views: number;
  minutes: number; // estimatedMinutesWatched (время просмотра)
  subscribersGained: number;
  subscribersLost: number;
  netSubscribers: number; // gained - lost
  avgViewPercentage: number; // averageViewPercentage (средний % досмотра)
}

// Текущий период + предыдущий равный (для дельт роста ↑/↓).
export interface PeriodComparison {
  days: number;
  current: PeriodMetrics;
  previous: PeriodMetrics | null; // null — не удалось получить прошлый период
}

// Точка кривой удержания (audience retention) для конкретного видео.
export interface RetentionPoint {
  ratio: number; // 0..1 — доля длины ролика (elapsedVideoTimeRatio)
  watchRatio: number; // audienceWatchRatio — доля зрителей (1 = 100% на старте)
  relative: number; // relativeRetentionPerformance 0..1 (0.5 = как похожие ролики)
}

// Детальная аналитика видео (ленивая, по клику): кривая удержания + сводка.
export interface VideoDetail {
  videoId: string;
  curve: RetentionPoint[]; // пусто — данных для кривой недостаточно
  avgRelative: number | null; // средний relativeRetentionPerformance по ролику
  // ISO8601-длительность ролика. Приходит только если клиент её не знал и попросил
  // (`needDuration`) — нужна, чтобы ось X кривой была в секундах, а не в % длины.
  duration?: string;
}

// Результат ИИ-разбора видео (тратит 1 запрос квоты): summary + варианты упаковки.
export interface VideoAnalysis {
  summary: { good: string[]; bad: string[] }; // что хорошо / что слабо
  titles: string[]; // варианты названия по ВИСП
  description: string; // переписанное описание
  tags: string[]; // предложенные теги
}

// Источник трафика за период (insightTrafficSourceType), уже с русским лейблом.
export interface TrafficSource {
  source: string; // код (RELATED_VIDEO/YT_SEARCH/BROWSE/EXT_URL/… или __OTHER__)
  label: string; // русский лейбл
  views: number;
  minutes: number;
}

// Аудитория за период: демография (возраст/пол), гео, устройства.
export interface AudienceData {
  age: { group: string; pct: number }[]; // % зрителей по возрасту
  gender: { label: string; pct: number }[]; // % по полу
  geo: { label: string; views: number; pct: number }[]; // топ стран
  devices: { label: string; views: number; pct: number }[]; // по устройствам
}

// ── Компактный снимок канала для контекста ассистента в чате ──────────────────
// Лёгкая выжимка (не весь дашборд): подставляется в system-промпт, чтобы нейронка
// разбирала канал предметно по цифрам. Кэшируется отдельно (см. youtube.ts).
export interface ChannelSnapshotVideo {
  title: string;
  views: number;
  retention: number | null; // средний % досмотра (avgViewPercentage)
  publishedAt: string;
}
export interface ChannelSnapshotPeriod {
  days: number;
  views: number;
  minutes: number;
  subscribersNet: number;
  avgRetention: number;
  prevViews: number | null;
  prevSubscribersNet: number | null;
  prevAvgRetention: number | null;
}
export interface ChannelSnapshot {
  title: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  period: ChannelSnapshotPeriod | null;
  topVideos: ChannelSnapshotVideo[];
  traffic: { label: string; pct: number }[];
  subscriberDrivers: { title: string; net: number }[];
}

// Ответ GET /api/integrations/youtube/data (дашборд «Канал»).
export interface YouTubeData {
  connected: boolean;
  channel?: YouTubeChannelInfo;
  videos?: YouTubeVideo[];
  // Курсор на следующую страницу видео (null/пусто — больше нет). Раздел «Канал»
  // догружает остальные ролики по нему через /videos.
  videosNextPageToken?: string | null;
  // null — аналитика недоступна (нет прав/данных), график просто не рисуем.
  daily?: DailyPoint[] | null;
  // Сравнение периодов для KPI-карточек с дельтами; null — аналитика недоступна.
  period?: PeriodComparison | null;
  // Источники трафика за выбранный период (топ + «Другое»); null — недоступно.
  traffic?: TrafficSource[] | null;
  // Динамика подписчиков за период (по дням + видео-драйверы); null — недоступно.
  subscribers?: SubscriberDynamics | null;
  // Аудитория за период (демография/гео/устройства); null — данных недостаточно.
  audience?: AudienceData | null;
  // Когда данные реально дёрнуты из YouTube (ISO). При отдаче из кэша — время
  // исходного запроса, а не текущее. UI показывает «обновлено …».
  fetchedAt?: string;
}
