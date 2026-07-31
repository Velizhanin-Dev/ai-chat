import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  getValidAccessToken,
  fetchChannelInfo,
  fetchRecentVideosWithAnalytics,
  fetchDailyAnalytics,
  fetchPeriodSummary,
  fetchTrafficSources,
  fetchSubscriberVideos,
  fetchSubscriberTimeline,
  fetchAudience,
  fetchVideoSubs,
  fetchContentSplit,
  periodRanges,
  assertOwnedProject,
  statsCacheKey,
  getCachedStats,
  setCachedStats,
} from "@/lib/youtube";
import {
  PERIOD_DAYS,
  type YouTubeData,
  type PeriodComparison,
  type VideoPage,
} from "@/lib/youtube-types";

// Живые данные канала ПРОЕКТА для дашборда «Канал»: инфа о канале + последние
// видео + аналитика за выбранный период (?period=7|28|90|365, дефолт 28) со
// сравнением с предыдущим равным окном. Токен обновляем при необходимости.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") || "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  // Валидируем период: только из белого списка, иначе 28.
  const reqDays = Number(url.searchParams.get("period"));
  const days = (PERIOD_DAYS as readonly number[]).includes(reqDays) ? reqDays : 28;
  const ranges = periodRanges(days);

  // Кэш дашборда: повторные заходы и переключение периода отдаём из памяти (экономим
  // квоту YouTube API). `?refresh=1` (кнопка «Обновить») форсит свежую выборку.
  const cacheKey = statsCacheKey(owned, days);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  if (!forceRefresh) {
    const cached = getCachedStats(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (!integ) return NextResponse.json({ connected: false } satisfies YouTubeData);

  try {
    const accessToken = await getValidAccessToken(integ);
    const channel = await fetchChannelInfo(accessToken);
    if (!channel) return apiError("Канал не найден", 502, "YT_ERROR");

    const [
      videosPage,
      daily,
      curSummary,
      prevSummary,
      traffic,
      subVideos,
      audience,
      subsByVideo,
      contentSplit,
    ] = await Promise.all([
      channel.uploadsPlaylistId
        ? fetchRecentVideosWithAnalytics(accessToken, channel.uploadsPlaylistId)
        : Promise.resolve<VideoPage>({ videos: [], nextPageToken: null }),
      fetchDailyAnalytics(accessToken, ranges.current.start, ranges.current.end),
      fetchPeriodSummary(accessToken, ranges.current.start, ranges.current.end),
      fetchPeriodSummary(accessToken, ranges.previous.start, ranges.previous.end),
      fetchTrafficSources(accessToken, ranges.current.start, ranges.current.end),
      fetchSubscriberVideos(accessToken, ranges.current.start, ranges.current.end),
      fetchAudience(accessToken, ranges.current.start, ranges.current.end),
      // Диагностика: конверсия в подписку по каждому ролику + кто приводит
      // подписчиков — шортсы или лонги. Два лёгких запроса, оба best-effort.
      fetchVideoSubs(accessToken, ranges.current.start, ranges.current.end),
      fetchContentSplit(accessToken, ranges.current.start, ranges.current.end),
    ]);
    const videos = videosPage.videos;

    // Сравнение периодов — только если получили текущий агрегат.
    const period: PeriodComparison | null = curSummary
      ? { days, current: curSummary, previous: prevSummary }
      : null;

    // Таймлайн роста (просмотры + прирост по видео + релизы) — переиспользует уже
    // полученные daily/subVideos/videos, добавляет лишь дневной ряд по драйверам.
    const timeline = daily
      ? await fetchSubscriberTimeline(
          accessToken,
          ranges.current.start,
          ranges.current.end,
          days,
          daily,
          subVideos,
          videos
        )
      : null;

    // Динамика подписчиков: по дням берём из daily (там уже gained/lost),
    // видео-драйверы — отдельным запросом. null — если нет дневного ряда.
    const subscribers: YouTubeData["subscribers"] = daily
      ? {
          daily: daily.map((d) => ({
            date: d.date,
            gained: d.subscribersGained,
            lost: d.subscribersLost,
          })),
          topVideos: subVideos,
          timeline,
        }
      : null;

    const payload: YouTubeData = {
      connected: true,
      channel,
      videos,
      videosNextPageToken: videosPage.nextPageToken,
      daily,
      period,
      traffic,
      subscribers,
      audience,
      subsByVideo,
      contentSplit,
      fetchedAt: new Date().toISOString(),
    };
    setCachedStats(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    // 401/403 от Google или невозможность обновить токен — просим переподключить.
    if (status === 401 || status === 403 || msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[youtube data]", err);
    return apiError("Не удалось загрузить данные YouTube", 502, "YT_ERROR");
  }
}
