import { prisma } from "./prisma";
import { getValidAccessToken, fetchPeriodVideos } from "./youtube";
import type { LinkVideo } from "./content-plan";

// ── Видео канала для контент-плана (пикер привязки + ресинк просмотров) ─────
// Общий помощник: один кэш на оба сценария, чтобы не дёргать YouTube дважды.

const CACHE = new Map<string, { at: number; videos: LinkVideo[] }>();
const TTL_MS = 15 * 60 * 1000;
const WINDOW_DAYS = 3 * 365;

export type ChannelVideosResult =
  | { status: "ok"; videos: LinkVideo[] }
  | { status: "not_connected" }
  | { status: "reauth" }
  | { status: "error" };

// Видео канала проекта. force=true — мимо кэша (кнопка «обновить цифры»).
export async function getChannelVideos(
  conversationId: string,
  force = false
): Promise<ChannelVideosResult> {
  const integ = await prisma.youTubeIntegration.findUnique({ where: { conversationId } });
  if (!integ) return { status: "not_connected" };

  const cached = CACHE.get(conversationId);
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return { status: "ok", videos: cached.videos };
  }

  try {
    const accessToken = await getValidAccessToken(integ);
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const raw = await fetchPeriodVideos(
      accessToken,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10)
    );
    const videos: LinkVideo[] = raw.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnail: v.thumbnail,
      views: v.viewCount,
      publishedAt: v.publishedAt,
    }));
    CACHE.set(conversationId, { at: Date.now(), videos });
    return { status: "ok", videos };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    if (status === 401 || status === 403 || msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return { status: "reauth" };
    }
    console.error("[content-plan channel videos]", err);
    return { status: "error" };
  }
}
