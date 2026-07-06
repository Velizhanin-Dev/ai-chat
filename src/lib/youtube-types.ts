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
  // Аналитика видео (best-effort, требует yt-analytics.readonly; может отсутствовать).
  avgViewPercentage?: number; // средний % досмотра (удержание) за всё время
  avgViewDuration?: number; // средняя длительность просмотра, секунды
  watchMinutes?: number; // суммарное время просмотра, минуты
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

// Динамика подписчиков за период: по дням (пришло/ушло) + видео-драйверы.
export interface SubscriberDynamics {
  daily: { date: string; gained: number; lost: number }[];
  topVideos: SubscriberVideo[]; // по net-приросту (лидеры сверху)
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

// Ответ GET /api/integrations/youtube/data (дашборд «Канал»).
export interface YouTubeData {
  connected: boolean;
  channel?: YouTubeChannelInfo;
  videos?: YouTubeVideo[];
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
}
