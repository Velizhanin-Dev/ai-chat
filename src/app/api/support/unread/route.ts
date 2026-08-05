import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";

// Сколько ответов поддержки пользователь ещё не открывал — бейдж на кнопке
// «Нужна помощь?» в сайдбаре. Дёргается поллингом, поэтому запрос предельно
// дешёвый (count по индексу (role, readAt)).

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const count = await prisma.supportMessage.count({
    where: { userId: user.id, role: "admin", readAt: null },
  });
  return NextResponse.json({ count });
}
