// ── Сбор вопросов зрителей под роликами своего канала ────────────────────────
//
// ⚠️ Ходим ПУБЛИЧНЫМ путём (пул ключей, `commentThreads.list` — 1 unit на ролик), а
// не под OAuth-токеном канала: комментарии публичные, а квота OAuth-вызовов у нас
// уходит на аналитику. Десять роликов = около 11 units против 100 за один поиск.
//
// ⚠️ Кэш на 6 часов: комментарии копятся медленно, а вопрос «о чём спрашивают»
// человек задаёт не чаще раза в день.

import { prisma } from "./prisma";
import { normalizePlatform } from "./platform";
import { getValidToken, fetchRecentReelsLite, fetchReelComments, IgReauthError } from "./instagram";
import { getPublicStats } from "./youtube-public";
import { getValidAccessToken, fetchChannelInfo, fetchRecentVideos } from "./youtube";
import { fetchTopComments } from "./youtube-search";
import { hasYoutubeKeys } from "./youtube-keys";
import {
  groupQuestions,
  looksLikeQuestion,
  type AudienceQuestion,
  type AudienceQuestionsResult,
} from "./audience-questions";

// Сколько последних роликов опрашиваем. ⚠️ Не больше: каждый ролик — свой запрос,
// а вопросы под старыми роликами всё равно про то, что уже неактуально.
const VIDEOS_TO_SCAN = 10;
const COMMENTS_PER_VIDEO = 30;
const TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; data: AudienceQuestionsResult }>();

export type QuestionsOutcome =
  | { status: "ok"; result: AudienceQuestionsResult; cached: boolean }
  | { status: "not_connected" }
  | { status: "reauth" }
  | { status: "no_keys" }
  | { status: "error"; message: string };

/** Уже собранные темы из кэша — для контекста чата (0 запросов к API). */
export function getCachedQuestions(conversationId: string): AudienceQuestionsResult | null {
  const hit = cache.get(conversationId);
  return hit && Date.now() - hit.at < TTL_MS ? hit.data : null;
}

export async function collectAudienceQuestions(
  conversationId: string,
  force = false
): Promise<QuestionsOutcome> {
  const hit = cache.get(conversationId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return { status: "ok", result: hit.data, cached: true };
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { platform: true },
  });
  if (normalizePlatform(conv?.platform) === "instagram") {
    return collectInstagramQuestions(conversationId);
  }

  // ⚠️ Пул ключей нужен только YouTube-ветке: Instagram ходит под токеном аккаунта.
  if (!hasYoutubeKeys()) return { status: "no_keys" };

  const integ = await prisma.youTubeIntegration.findUnique({ where: { conversationId } });

  try {
    // Ролики для обхода. Под OAuth берём их токеном канала (видно и скрытые от
    // поиска, и порядок ровно авторский); без него — публичным списком у канала,
    // привязанного по ссылке.
    //
    // ⚠️ Комментарии ПУБЛИЧНЫ, поэтому этот раздел работает и без OAuth: человеку
    // с каналом на бренд-аккаунте он доступен полностью, в отличие от удержания.
    let videos: { id: string; title: string }[];
    if (integ) {
      const token = await getValidAccessToken(integ);
      const info = await fetchChannelInfo(token);
      if (!info?.uploadsPlaylistId) {
        return { status: "error", message: "Канал не отдал список роликов" };
      }
      const page = await fetchRecentVideos(token, info.uploadsPlaylistId, VIDEOS_TO_SCAN);
      videos = page.videos.map((v) => ({ id: v.id, title: v.title }));
    } else {
      const pub = await getPublicStats(conversationId);
      if (!pub) return { status: "not_connected" };
      videos = pub.videos.slice(0, VIDEOS_TO_SCAN).map((v) => ({ id: v.id, title: v.title }));
    }

    const questions: AudienceQuestion[] = [];
    let scanned = 0;

    for (const video of videos) {
      // ⚠️ Комментарии могут быть отключены (403) — это не ошибка сбора, просто
      // под этим роликом вопросов нет.
      const comments = await fetchTopComments(video.id, COMMENTS_PER_VIDEO).catch(() => []);
      scanned += 1;
      for (const c of comments) {
        if (!looksLikeQuestion(c.text)) continue;
        questions.push({
          text: c.text.replace(/\s+/g, " ").trim().slice(0, 400),
          likes: c.likes,
          videoId: video.id,
          videoTitle: video.title,
        });
      }
    }

    const result: AudienceQuestionsResult = {
      platform: "youtube",
      topics: groupQuestions(questions),
      total: questions.length,
      videosScanned: scanned,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(conversationId, { at: Date.now(), data: result });
    return { status: "ok", result, cached: false };
  } catch (err) {
    console.error("[questions] сбор вопросов:", err);
    return { status: "error", message: "Не удалось собрать вопросы зрителей" };
  }
}

// Instagram: комментарии под своими рилсами через Graph API под токеном аккаунта
// (скоуп instagram_business_manage_comments). ⚠️ В отличие от YouTube, публичного
// пути тут нет — Graph отдаёт только СВОЙ аккаунт, поэтому без подключения блока
// просто нет. Один запрос на список рилсов + по одному на рилс.
async function collectInstagramQuestions(conversationId: string): Promise<QuestionsOutcome> {
  const token = await getValidToken(conversationId);
  if (!token) {
    // Нет токена = либо не подключали, либо протух (getValidToken молча отдаёт null).
    const row = await prisma.instagramIntegration.findUnique({
      where: { conversationId },
      select: { conversationId: true },
    });
    return row ? { status: "reauth" } : { status: "not_connected" };
  }
  try {
    const reels = await fetchRecentReelsLite(token, VIDEOS_TO_SCAN);
    const questions: AudienceQuestion[] = [];
    let scanned = 0;
    for (const reel of reels) {
      // Best-effort на рилс: комментарии могли отключить — это не ошибка сбора.
      const comments = await fetchReelComments(token, reel.id, COMMENTS_PER_VIDEO).catch((err) => {
        if (err instanceof IgReauthError) throw err;
        return [];
      });
      scanned += 1;
      const title = reel.caption.split(/\r?\n/)[0].trim() || "Рилс без подписи";
      for (const c of comments) {
        if (!looksLikeQuestion(c.text)) continue;
        questions.push({
          text: c.text.replace(/\s+/g, " ").trim().slice(0, 400),
          likes: c.likes,
          videoId: reel.id,
          videoTitle: title,
        });
      }
    }
    const result: AudienceQuestionsResult = {
      platform: "instagram",
      topics: groupQuestions(questions),
      total: questions.length,
      videosScanned: scanned,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(conversationId, { at: Date.now(), data: result });
    return { status: "ok", result, cached: false };
  } catch (err) {
    if (err instanceof IgReauthError) return { status: "reauth" };
    console.error("[questions] instagram:", err);
    return { status: "error", message: "Не удалось прочитать комментарии Instagram" };
  }
}

/** Сброс кэша — например, после переподключения канала. */
export function clearQuestionsCache(conversationId: string): void {
  cache.delete(conversationId);
}
