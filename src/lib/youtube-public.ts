// ── Канал по ссылке: публичная статистика без OAuth ─────────────────────────
//
// ⚠️⚠️ ЗАЧЕМ ЭТО ЕСТЬ. Часть клиентов держит канал на бренд-аккаунте компании и
// имеет к нему доступ только через Творческую студию — пройти наш Google-OAuth
// они физически не могут. До этого такой человек оставался вообще без цифр:
// ассистент не знал ни одного его ролика, темы предлагал «из головы», а раздел
// «Канал» был пустым. При этом ВСЯ публичная статистика канала доступна кому
// угодно по ссылке.
//
// Что достаём (пул ключей, публичные вызовы Data API):
//   • канал: подписчики, суммарные просмотры, число роликов, описание, аватар;
//   • ролики: название, дата, просмотры, лайки, комментарии, длительность;
//   • теги роликов (через скрейп страницы, 0 units) — лексика ниши словами автора;
//   • комментарии зрителей — работают и тут (раздел «О чём спрашивают зрители»).
//
// ⚠️ Чего НЕТ и не может быть: удержание, CTR и показы, источники трафика,
// подписчики по роликам, демография. Это Analytics API, и он отдаёт данные
// ТОЛЬКО владельцу под OAuth. Поэтому режим честно урезанный, а не «то же самое
// подешевле»: везде, где цифры нет, мы так и пишем, а не подставляем ноль.
//
// ⚠️ Цена в units: канал 1 + список роликов (1 на 50) + метаданные (1 на 50).
// Канал на 200 роликов ≈ 9 units из 10 000 суточных. Кэш 15 минут, как у
// OAuth-дашборда.

import { prisma } from "./prisma";
import {
  fetchChannelUploads,
  fetchChannelsByIds,
  resolveChannel,
  type PublicVideo,
} from "./youtube-search";
import { fetchVideoTags } from "./youtube-scrape";
import type { ChannelSnapshot, ChannelSnapshotVideo } from "./youtube-types";

/** Сколько роликов канала тянем максимум: дальше растёт цена и падает польза. */
const MAX_VIDEOS = 150;
/** Сколько роликов показываем модели в снимке. */
const SNAPSHOT_VIDEOS = 12;
/** У скольких верхних роликов добираем теги (каждый — отдельная страница). */
const TAG_VIDEOS = 6;

const STATS_TTL_MS = 15 * 60 * 1000;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export interface PublicChannelInfo {
  channelId: string;
  title: string;
  thumbnail: string | null;
  customUrl: string | null;
  subscribers: number;
  hiddenSubs: boolean;
  videoCount: number;
  views: number;
}

export interface PublicChannelStats {
  channel: PublicChannelInfo;
  videos: PublicVideo[];
  /** Медиана просмотров по каналу — с ней и сравниваем каждый ролик. */
  medianViews: number;
  fetchedAt: string;
}

// ── Кэши (в памяти процесса, как у дашборда) ────────────────────────────────
const statsCache = new Map<string, { at: number; data: PublicChannelStats }>();
const snapshotCache = new Map<string, { at: number; data: ChannelSnapshot }>();

export function clearPublicChannelCache(conversationId: string): void {
  statsCache.delete(conversationId);
  snapshotCache.delete(conversationId);
}

/**
 * Привязать канал по ссылке / @хэндлу / id.
 *
 * ⚠️ Цена зависит от формы ввода (см. resolveChannel): id и хэндл — 1 unit,
 * поиск по названию — 100. Поэтому в UI просим именно ссылку.
 */
export async function linkChannel(
  conversationId: string,
  input: string
): Promise<{ ok: true; channel: PublicChannelInfo } | { ok: false; error: string }> {
  const found = await resolveChannel(input).catch(() => null);
  if (!found) {
    return {
      ok: false,
      error: "Не нашёл такой канал. Скопируйте ссылку из адресной строки канала на YouTube.",
    };
  }

  const info: PublicChannelInfo = {
    channelId: found.id,
    title: found.title,
    thumbnail: found.thumbnail,
    customUrl: found.customUrl,
    subscribers: found.subscribers,
    hiddenSubs: found.hiddenSubscribers,
    videoCount: found.videoCount,
    views: found.views,
  };

  await prisma.channelLink.upsert({
    where: { conversationId },
    create: { conversationId, ...info },
    update: { ...info },
  });
  clearPublicChannelCache(conversationId);
  return { ok: true, channel: info };
}

export async function unlinkChannel(conversationId: string): Promise<void> {
  await prisma.channelLink.deleteMany({ where: { conversationId } });
  clearPublicChannelCache(conversationId);
}

/** Публичная статистика канала проекта. null — канал по ссылке не привязан. */
export async function getPublicStats(
  conversationId: string,
  refresh = false
): Promise<PublicChannelStats | null> {
  const cached = statsCache.get(conversationId);
  if (!refresh && cached && Date.now() - cached.at < STATS_TTL_MS) return cached.data;

  const link = await prisma.channelLink.findUnique({ where: { conversationId } });
  if (!link) return null;

  try {
    // Свежие цифры канала (подписчики могли измениться с момента привязки) и
    // список роликов. Оба вызова дешёвые.
    const [fresh, videos] = await Promise.all([
      fetchChannelsByIds([link.channelId]).then((m) => m.get(link.channelId) ?? null),
      fetchChannelUploads(link.channelId, MAX_VIDEOS),
    ]);

    const channel: PublicChannelInfo = fresh
      ? {
          channelId: fresh.id,
          title: fresh.title,
          thumbnail: fresh.thumbnail,
          customUrl: fresh.customUrl,
          subscribers: fresh.subscribers,
          hiddenSubs: fresh.hiddenSubscribers,
          videoCount: fresh.videoCount,
          views: fresh.views,
        }
      : {
          channelId: link.channelId,
          title: link.title,
          thumbnail: link.thumbnail,
          customUrl: link.customUrl,
          subscribers: link.subscribers,
          hiddenSubs: link.hiddenSubs,
          videoCount: link.videoCount,
          views: link.views,
        };

    // Обновляем снимок в БД, чтобы карточка «подключено» не устаревала.
    if (fresh) {
      void prisma.channelLink
        .update({ where: { conversationId }, data: { ...channel } })
        .catch(() => {});
    }

    const sorted = [...videos].sort((a, b) =>
      a.publishedAt < b.publishedAt ? 1 : -1
    );
    const data: PublicChannelStats = {
      channel,
      videos: sorted,
      medianViews: median(sorted.map((v) => v.views)),
      fetchedAt: new Date().toISOString(),
    };
    statsCache.set(conversationId, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.error("[youtube-public] не удалось собрать статистику:", err);
    // Протухший кэш лучше пустого экрана: цифры вчерашние, но реальные.
    return cached?.data ?? null;
  }
}

/**
 * Снимок канала для промпта — та же форма, что у OAuth-снимка.
 *
 * ⚠️ `retention`, `traffic`, `subscriberDrivers` и `period` остаются пустыми: их
 * неоткуда взять без Analytics API. buildChannelBlock их не рисует, если пусто, —
 * то есть модель просто не увидит того, чего мы не знаем, и не сможет выдумать.
 */
export async function getPublicSnapshot(
  conversationId: string
): Promise<ChannelSnapshot | null> {
  const cached = snapshotCache.get(conversationId);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.data;

  const stats = await getPublicStats(conversationId);
  if (!stats) return null;

  // Теги верхних роликов — живая лексика ниши словами автора. Достаются скрейпом
  // страницы (в Data API их с 2021 видит только владелец), 0 units, best-effort.
  const top = [...stats.videos].sort((a, b) => b.views - a.views).slice(0, TAG_VIDEOS);
  const tagLists = await Promise.all(
    top.map((v) => fetchVideoTags(v.id).catch(() => null))
  );
  const nicheWords: string[] = [];
  const seen = new Set<string>();
  for (const list of tagLists) {
    for (const t of list?.tags ?? []) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      nicheWords.push(t);
      if (nicheWords.length >= 25) break;
    }
    if (nicheWords.length >= 25) break;
  }

  const topVideos: ChannelSnapshotVideo[] = stats.videos.slice(0, SNAPSHOT_VIDEOS).map((v) => ({
    title: v.title,
    views: v.views,
    retention: null, // без Analytics API удержания нет — и мы об этом честно молчим
    publishedAt: v.publishedAt,
  }));

  const snap: ChannelSnapshot = {
    title: stats.channel.title,
    subscribers: stats.channel.subscribers,
    totalViews: stats.channel.views,
    videoCount: stats.channel.videoCount,
    nicheWords: nicheWords.length ? nicheWords : undefined,
    period: null,
    topVideos,
    traffic: [],
    subscriberDrivers: [],
  };
  snapshotCache.set(conversationId, { at: Date.now(), data: snap });
  return snap;
}

function median(nums: number[]): number {
  const list = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
}
