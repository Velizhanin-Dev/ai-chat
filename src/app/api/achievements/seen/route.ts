import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { markAchievementsSeen } from "@/lib/achievements-server";

// Пользователь посмотрел ачивки — гасим метки «новое» (seenAt).

export async function POST() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  await markAchievementsSeen(user.id);
  return NextResponse.json({ ok: true });
}
