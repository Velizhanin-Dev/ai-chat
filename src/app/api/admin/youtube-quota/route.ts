import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { keyPoolStatus, hasYoutubeKeys } from "@/lib/youtube-keys";

export const dynamic = "force-dynamic";

// GET /api/admin/youtube-quota — состояние пула ключей поиска по YouTube.
//
// ⚠️ Живёт в админке, а не в самом разделе: для пользователя «Поиск референсов» —
// просто рабочая функция, а units, ключи и суточные лимиты — наша внутренняя кухня.
// Раньше это висело прямо над кнопкой «Найти» и читалось как «осторожно, дорого».
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Не найдено", 404);
  return NextResponse.json({ configured: hasYoutubeKeys(), quota: keyPoolStatus() });
}
