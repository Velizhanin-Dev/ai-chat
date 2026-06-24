import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser, publicUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { sanitizeBrief, isBriefComplete } from "@/lib/brief";

// Сохранение брифа клиента + результата DISC. Обязательный онбординг, кнопка
// «Пройти бриф заново» в настройках и мост анонимного брифа (заполнен на /brief
// по QR) бьют сюда. Поля «о проекте» необязательны — briefCompletedAt ставим, как
// только пройден DISC-тест (isBriefComplete), это снимает гейт.
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const brief = sanitizeBrief(body?.brief);
  if (!isBriefComplete(brief)) {
    return apiError("Сначала пройдите тест о себе", 400);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { brief: brief as unknown as Prisma.InputJsonValue, briefCompletedAt: new Date() },
  });
  return NextResponse.json({ user: publicUser(updated) });
}
