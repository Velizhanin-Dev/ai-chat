import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getAchievementsView } from "@/lib/achievements-server";

// Витрина ачивок текущего пользователя (docs/achievements.md). Прогресс всегда
// пересчитывается из счётчиков — отдельного кэша нет.

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const view = await getAchievementsView(user.id);
  return NextResponse.json(view);
}
