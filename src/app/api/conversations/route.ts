import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";

// Список диалогов текущего пользователя — только метаданные (id/title/даты),
// без сообщений. Сообщения тянутся лениво по клику (GET /api/conversations/[id]).
// Свежие сверху. Лимит — отсечка на случай очень большой истории.
const LIST_LIMIT = 200;

export type ConversationMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите, чтобы посмотреть историю", 401);

  const rows = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    take: LIST_LIMIT,
  });

  const conversations: ConversationMeta[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return NextResponse.json({ conversations });
}
