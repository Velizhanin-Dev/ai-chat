import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  getValidAccessToken,
  fetchVideoRetention,
  assertOwnedProject,
} from "@/lib/youtube";

// Детальная аналитика одного видео (ленивая, по клику на карточку): кривая
// удержания + relativeRetentionPerformance. projectId + videoId в query.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") || "";
  const videoId = url.searchParams.get("videoId") || "";
  // Дата публикации видео (YYYY-MM-DD) — сужает окно запроса retention (иначе 20-летний
  // диапазон тормозит запрос). Принимаем только валидный формат.
  const startRaw = url.searchParams.get("start") || "";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : undefined;
  if (!videoId) return apiError("Не указан videoId");

  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (!integ) return apiError("YouTube не подключён", 404);

  try {
    const accessToken = await getValidAccessToken(integ);
    const detail = await fetchVideoRetention(accessToken, videoId, start);
    // fetchVideoRetention сам глушит ошибки в null → отдаём пустую кривую.
    return NextResponse.json(detail ?? { videoId, curve: [], avgRelative: null });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    if (status === 401 || status === 403 || msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[youtube video]", err);
    return apiError("Не удалось загрузить данные видео", 502, "YT_ERROR");
  }
}
