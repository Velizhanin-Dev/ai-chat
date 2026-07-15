import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  getValidAccessToken,
  fetchChannelInfo,
  fetchRecentVideosWithAnalytics,
  assertOwnedProject,
} from "@/lib/youtube";
import type { VideoPage } from "@/lib/youtube-types";

// Подгрузка СЛЕДУЮЩИХ страниц видео канала (раздел «Канал» догружает все ролики).
// Первую страницу отдаёт /data (+videosNextPageToken); дальше идём по курсору.
// ?projectId=&pageToken=. Плейлист загрузок берём с сервера (не доверяем клиенту).
const PAGE_SIZE = 30;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") || "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const pageToken = url.searchParams.get("pageToken") || undefined;

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (!integ) return apiError("Канал не подключён", 404);

  try {
    const accessToken = await getValidAccessToken(integ);
    const channel = await fetchChannelInfo(accessToken);
    if (!channel?.uploadsPlaylistId) {
      return NextResponse.json({ videos: [], nextPageToken: null } satisfies VideoPage);
    }
    const page = await fetchRecentVideosWithAnalytics(
      accessToken,
      channel.uploadsPlaylistId,
      PAGE_SIZE,
      pageToken
    );
    return NextResponse.json(page satisfies VideoPage);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    if (status === 401 || status === 403 || msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[youtube videos]", err);
    return apiError("Не удалось загрузить видео", 502, "YT_ERROR");
  }
}
