import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  youtubeConfigured,
  revokeToken,
  assertOwnedProject,
  clearStatsCache,
} from "@/lib/youtube";
import type { YouTubeStatus } from "@/lib/youtube-types";

// Статус пер-проектной интеграции YouTube (для карточки в настройках проекта).
// projectId — id проекта (диалога); интеграция привязана к нему, не к юзеру.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });

  const status: YouTubeStatus = {
    configured: youtubeConfigured(),
    connected: Boolean(integ),
    channel: integ
      ? {
          channelId: integ.channelId,
          title: integ.title,
          thumbnail: integ.thumbnail,
          customUrl: integ.customUrl,
        }
      : null,
  };
  return NextResponse.json(status);
}

// Отключить интеграцию у проекта: отзываем токен в Google (best-effort) + удаляем.
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (integ) {
    await revokeToken(integ.refreshToken || integ.accessToken);
    await prisma.youTubeIntegration.delete({ where: { id: integ.id } });
    clearStatsCache(owned); // не отдавать закэшированные данные отключённого канала
  }
  return NextResponse.json({ ok: true });
}
