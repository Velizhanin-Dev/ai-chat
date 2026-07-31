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
  totalLost: number; // отписки за отрезок — нужны для восстановления кривой «всего подписчиков»
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

// ── Разбор канала по параметрам органического продвижения ─────────────────────
// Кнопка «Разобрать канал» в разделе «Канал». Сервер собирает цифры из Analytics
// API (ChannelDiagnostics), модель выставляет по каждому параметру балл 0-100 и
// говорит, что чинить (ChannelAnalysisResult). Круг в UI = params со score.

// Что разбираем. У лонгов 7 параметров продвижения, у шортсов — свои 6
// параметров конверсии (см. src/lib/channel-params.ts).
export type DiagnoseKind = "all" | "long" | "shorts";

// Окна разбора: 0 = за всё время жизни канала.
export const DIAGNOSE_PERIODS = [7, 28, 90, 365, 0] as const;
export type DiagnosePeriod = (typeof DIAGNOSE_PERIODS)[number];

// Ключи параметров: лонги (7) и шортсы (6). Union — один тип на оба режима.
// Порядок и состав семёрки — канон из закрытого TG («7 параметров органического
// продвижения», чек-лист «что упало»), см. knowledge-base-tg-closed.ts.
export type LongParamKey =
  | "first30" // удержание в первые 30 секунд
  | "retention" // удержание на всей длине
  | "avgDuration" // среднее время просмотра
  | "ctr" // кликабельность (превью + название)
  | "engagement" // вовлечение (лайки+дизлайки+комменты / просмотры)
  | "subscribe" // конверсия в подписку (правило одного процента)
  | "afterWatch"; // поведение аудитории после просмотра
export type ShortsParamKey =
  | "sRetention" // удержание шортса
  | "sFirst3" // удержание в первые 3 секунды
  | "sFirst30" // удержание в первые 30 секунд (шортс сейчас до 3 минут)
  | "sLike" // конверсия в лайк
  | "sShare" // конверсия в репост (топ-драйвер виральности)
  | "sSubscribe" // конверсия в подписку
  | "sComment"; // конверсия в комментарий
export type ParamKey = LongParamKey | ShortsParamKey;

// Измеренное значение параметра (то, что реально дал API).
export interface DiagnosticsMetric {
  key: ParamKey;
  // Число в единицах параметра; null — измерить не удалось (нет данных/API молчит).
  value: number | null;
  // Готовая строка для UI и промпта, напр. «42,3 %» или «4 мин 12 с».
  display: string;
  // Откуда цифра / чем заменили (прокси). Идёт в промпт, чтобы модель не врала.
  note?: string;
}

// Ролик, попавший в разбор (топ по просмотрам за период) — модель по ним видит
// разброс, а не только среднее по каналу.
export interface DiagnosticsVideo {
  id: string;
  title: string;
  views: number;
  retention: number | null; // средний % досмотра
  avgDuration: number | null; // среднее время просмотра, секунды
  durationSec: number;
  // Доля зрителей, оставшихся к N-й секунде: «3»/«30» → проценты. Отметки зависят
  // от среза (шортсы — 3 и 30, лонги — 30). null — кривой нет или ролик короче отметки.
  retentionAt: Record<string, number | null>;
  likes: number;
  comments: number;
  publishedAt: string;
}

// Снимок цифр канала под разбор. Кладётся в ChannelAnalysis.metrics, чтобы
// старый разбор в истории читался без повторного похода в YouTube.
export interface ChannelDiagnostics {
  kind: DiagnoseKind;
  periodDays: number; // 0 = за всё время
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string;
  channel: {
    title: string;
    subscribers: number;
    totalViews: number;
    videoCount: number;
  };
  totals: {
    views: number;
    minutes: number;
    subscribersGained: number;
    subscribersLost: number;
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    avgViewPercentage: number;
    avgViewDuration: number; // секунды
  };
  // Предыдущее равное окно — для трендов («растёт/падает»). null — не получили.
  prevTotals: { views: number; avgViewPercentage: number; subscribersGained: number } | null;
  metrics: DiagnosticsMetric[]; // по одному на каждый параметр режима
  traffic: TrafficSource[] | null;
  videos: DiagnosticsVideo[];
  // CTR, введённый руками из YouTube Studio (API его не отдаёт). null — не вводили.
  manualCtr: number | null;
  // Что не удалось измерить и почему — уходит в промпт и в подсказки UI.
  notes: string[];
}

// Вердикт модели по одному параметру. score — заполнение сектора круга.
export interface ParamVerdict {
  key: ParamKey;
  score: number; // 0-100
  verdict: "good" | "ok" | "bad";
  fact: string; // цифра канала против нормы, одной строкой
  why: string; // что это значит на практике
  todo: string[]; // 1-3 конкретных действия
}

// Результат разбора (кладётся в ChannelAnalysis.result).
export interface ChannelAnalysisResult {
  params: ParamVerdict[];
  overall: number; // 0-100, средний балл
  summary: string; // общий вывод, живым языком (markdown)
  priority: string[]; // 1-3 главных фокуса на ближайшие ролики
}

// Строка истории разборов (GET /api/integrations/youtube/diagnose).
export interface ChannelAnalysisRow {
  id: string;
  kind: DiagnoseKind;
  periodDays: number;
  overallScore: number;
  createdAt: string;
  manualCtr: number | null;
  metrics: ChannelDiagnostics;
  result: ChannelAnalysisResult;
}

// Метрики одного типа контента (шортсы или обычные видео) за период.
export interface ContentSplitRow {
  views: number;
  subscribersGained: number;
  avgViewPercentage: number;
}

// Разрез «шортсы против лонгов»: кто реально приводит подписчиков. null внутри —
// такого контента за период не было.
export interface ContentSplit {
  shorts: ContentSplitRow | null;
  long: ContentSplitRow | null;
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
  // Подписчики по каждому ролику за период (videoId → пришло/ушло). Из этого
  // считается конверсия в подписку на ролик — в Studio её нет. Пусто — не получили.
  subsByVideo?: Record<string, { gained: number; lost: number }> | null;
  // Разрез «шортсы против лонгов» за период; null — API не разделил контент.
  contentSplit?: ContentSplit | null;
  // Когда данные реально дёрнуты из YouTube (ISO). При отдаче из кэша — время
  // исходного запроса, а не текущее. UI показывает «обновлено …».
  fetchedAt?: string;
}
