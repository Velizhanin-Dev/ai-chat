// ── Instagram: чистые типы и математика (общие клиенту и серверу) ────────────
//
// ⚠️ Что API реально отдаёт по рилсу (Instagram API with Instagram Login,
// `instagram_business_manage_insights`), а чего нет и не будет:
//
//  ЕСТЬ: views, reach, likes, comments, shares, saved, total_interactions,
//        ig_reels_avg_watch_time (мс), ig_reels_video_view_total_time,
//        reels_skip_rate (доля пропусков в первые 3 секунды) и репосты.
//  НЕТ:  КРИВОЙ удержания по секундам (в приложении она есть, в API — только
//        число), источников просмотров и демографии ПО КОНКРЕТНОМУ рилсу
//        (демография доступна лишь на уровне аккаунта), графика лайков во времени
//        и динамики просмотров одного рилса по дням.
//
// ⚠️ Метрики возвращаются пустыми, пока у рилса мало охвата: Meta не публикует
// порог. Поэтому все поля метрик — `number | null`, и «нет данных» мы показываем
// как «нет данных», а не как ноль (ноль читался бы как «никто не смотрел»).

export interface IgAccount {
  id: string;
  username: string;
  name: string;
  profilePicture: string | null;
  followers: number;
  mediaCount: number;
}

export interface IgReel {
  id: string;
  caption: string;
  permalink: string;
  thumbnail: string | null;
  timestamp: string;
  /** Длительность рилса в секундах (из media, может отсутствовать). */
  duration: number | null;

  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  /** Среднее время просмотра в СЕКУНДАХ (API отдаёт миллисекунды — конвертируем). */
  avgWatchTime: number | null;
  /** Доля пропусков в первые 3 секунды, 0..1. */
  skipRate: number | null;
}

export interface IgSnapshot {
  account: IgAccount;
  reels: IgReel[];
  periodDays: number;
  fetchedAt: string;
}

// ── Производные показатели ──────────────────────────────────────────────────

/** Доля от охвата в процентах. null, если делить не на что. */
export function shareOf(part: number | null, base: number | null): number | null {
  if (part == null || !base) return null;
  return (part / base) * 100;
}

/**
 * Удержание: сколько процентов рилса досмотрели в среднем.
 *
 * ⚠️ Это ОЦЕНКА, а не кривая из приложения: API отдаёт только среднее время
 * просмотра, поэтому делим его на длительность. Значение может превысить 100% —
 * рилсы зациклены, и повторные просмотры засчитываются в то же время просмотра.
 * Клампим на 100, но в подписи честно называем это «в среднем досмотрено».
 */
export function retentionPercent(reel: IgReel): number | null {
  if (reel.avgWatchTime == null || !reel.duration) return null;
  return Math.min(100, (reel.avgWatchTime / reel.duration) * 100);
}

export type Verdict = "better" | "usual" | "worse";

/**
 * Как показатель смотрится на фоне ОСТАЛЬНЫХ рилсов аккаунта.
 *
 * Тот же приём, что Instagram показывает подписью «ниже, чем обычно»: сравниваем
 * с медианой своих же рилсов, а не с абстрактной нормой по рынку — у каждого
 * аккаунта своя база. Полоса ±15% вокруг медианы — «как всегда»: без неё любое
 * колебание читалось бы как тренд.
 *
 * higherIsBetter=false для доли пропусков: там чем меньше, тем лучше.
 */
export function compareToUsual(
  value: number | null,
  others: number[],
  higherIsBetter = true
): Verdict | null {
  if (value == null || others.length < 3) return null;
  const med = median(others);
  if (!med) return null;
  const diff = (value - med) / med;
  if (Math.abs(diff) <= 0.15) return "usual";
  const better = higherIsBetter ? diff > 0 : diff < 0;
  return better ? "better" : "worse";
}

export function median(xs: number[]): number {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  better: "лучше, чем обычно",
  usual: "как всегда",
  worse: "хуже, чем обычно",
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  better: "teal",
  usual: "gray",
  worse: "red",
};

/** «12,4%» — доли показываем с одним знаком, это не бухгалтерия. */
export function formatShare(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/** «7,2 сек» — среднее время просмотра. */
export function formatSeconds(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1).replace(".", ",")} сек`;
}

/**
 * Вовлечение = лайки + комментарии + сохранения + репосты от охвата.
 *
 * Считаем СУММОЙ реакций, а не по отдельности: по одному показателю рилс почти
 * никогда не проседает — проседает интерес целиком.
 */
export function engagementRate(reel: IgReel): number | null {
  if (!reel.reach) return null;
  const parts = [reel.likes, reel.comments, reel.saved, reel.shares];
  if (parts.every((p) => p == null)) return null;
  const sum = parts.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  return (sum / reel.reach) * 100;
}
