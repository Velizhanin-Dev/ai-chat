import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { getChannelVideos } from "@/lib/content-plan-channel";

export const dynamic = "force-dynamic";

// GET /api/content-plan/channel-videos?projectId= — видео канала проекта для
// привязки/импорта в контент-план. Кэш и запрос к YouTube — в content-plan-channel.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const res = await getChannelVideos(owned);
  if (res.status === "not_connected") return NextResponse.json({ connected: false, videos: [] });
  if (res.status === "reauth") return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
  if (res.status === "error") return apiError("Не удалось получить видео канала", 502);
  return NextResponse.json({ connected: true, videos: res.videos });
}
