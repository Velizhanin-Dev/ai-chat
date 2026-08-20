import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { fetchVideoInsight } from "@/lib/competitors-server";
import { videoIdFromUrl } from "@/lib/competitors";

export const dynamic = "force-dynamic";

// GET /api/video-insight?projectId=&video= — данные чужого ролика для разбора
// референса ассистентом: название, описание (часто с тайм-кодами), метрики,
// топ-комментарии. ~3 units квоты YouTube, публичные данные.
//
// ⚠️ Гейт тут по СЕССИИ и владению проектом, а не `getAdminUser`, как в разделе
// конкурентов: кнопка «Сгенерировать сценарий» живёт в контент-плане, который
// открыт всем залогиненным. Раздел конкурентов остаётся админским отдельно.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const sp = new URL(req.url).searchParams;
  const owned = await assertOwnedProject(user.id, sp.get("projectId") ?? "");
  if (!owned) return apiError("Проект не найден", 404);

  // Принимаем и голый id, и ссылку — в поле reference лежит именно ссылка.
  const raw = (sp.get("video") ?? "").trim();
  const videoId = videoIdFromUrl(raw) ?? (/^[\w-]{6,}$/.test(raw) ? raw : null);
  if (!videoId) return apiError("Не похоже на ссылку на ролик");

  const out = await fetchVideoInsight(videoId);
  if (out.status === "not_found") return apiError("Ролик не найден", 404);
  if (out.status === "no_keys")
    return apiError("Поиск по YouTube не настроен — обратитесь к администратору", 503, "YT_NO_KEYS");
  if (out.status === "quota")
    return apiError(
      "Лимит запросов к YouTube на сегодня исчерпан — обновится ночью",
      429,
      "YT_QUOTA"
    );
  if (out.status === "error") return apiError(out.message, 502);

  return NextResponse.json({ insight: out.insight });
}
