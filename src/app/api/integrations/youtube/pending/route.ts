import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { youtubeConfigured, revokeToken, getPendingConnection } from "@/lib/youtube";
import type { YouTubeStatus } from "@/lib/youtube-types";

// Статус ЧЕРНОВОГО подключения канала (шаг брифа, проекта ещё нет). Привязка — к
// юзеру, поэтому projectId тут не нужен. Тот же формат ответа, что у пер-проектного
// статуса, — UI переиспользует карточку «подключено».
export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const pending = await getPendingConnection(user.id);
  const status: YouTubeStatus = {
    configured: youtubeConfigured(),
    connected: Boolean(pending),
    channel: pending
      ? {
          channelId: pending.channelId,
          title: pending.title,
          thumbnail: pending.thumbnail,
          customUrl: pending.customUrl,
        }
      : null,
  };
  return NextResponse.json(status);
}

// Отменить черновое подключение (юзер передумал / хочет другой канал): отзываем
// токен в Google (best-effort) и удаляем черновик.
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const pending = await getPendingConnection(user.id);
  if (pending) {
    await revokeToken(pending.refreshToken || pending.accessToken);
    await prisma.youTubePendingConnection.delete({ where: { id: pending.id } });
  }
  return NextResponse.json({ ok: true });
}
