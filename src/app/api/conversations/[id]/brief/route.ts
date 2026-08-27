import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { sanitizeBrief, isBriefComplete } from "@/lib/brief";
import { ensureProfileJob } from "@/lib/project-profile-server";

// Бриф конкретного проекта (диалога): чтение для страницы настроек проекта и
// перезапись при «Исправить информацию». Всё с проверкой владения — чужой проект
// не отдаём/не трогаем (404). Бриф пер-проектный (Conversation.brief).

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);

  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { userId: true, brief: true },
  });
  if (!conv || conv.userId !== user.id) return apiError("Not found", 404);

  return NextResponse.json({ brief: sanitizeBrief(conv.brief) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);

  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { userId: true },
  });
  if (!conv || conv.userId !== user.id) return apiError("Not found", 404);

  const body = await readJson(req);
  const brief = sanitizeBrief(body?.brief);
  // Тип личности (DISC) обязателен — как и при создании проекта.
  if (!isBriefComplete(brief)) {
    return apiError("Пройди тест типа личности до конца", 400, "BRIEF_INCOMPLETE");
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data: { brief: brief as unknown as Prisma.InputJsonValue },
  });
  // Бриф поменялся — профиль, собранный по старым ответам, устарел. Пересобираем
  // в фоне (force: старый профиль есть, но он теперь про другой проект).
  void ensureProfileJob({ userId: user.id, projectId: params.id, force: true });
  return NextResponse.json({ ok: true, brief });
}
