import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser, publicUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { sanitizeBrief, isBriefComplete } from "@/lib/brief";

// Сохранение брифа клиента + результата DISC. Обязательный онбординг и кнопка
// «Пройти бриф заново» в настройках бьют сюда. briefCompletedAt ставим только
// когда бриф реально полный (ключевые поля + тип DISC) — это снимает гейт.
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const brief = sanitizeBrief(body?.brief);
  if (!isBriefComplete(brief)) {
    return apiError("Заполните бриф полностью и пройдите тест", 400);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { brief: brief as unknown as Prisma.InputJsonValue, briefCompletedAt: new Date() },
  });
  return NextResponse.json({ user: publicUser(updated) });
}
