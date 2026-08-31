import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { parseChatAttachments } from "@/lib/chat-attachments";

// Один диалог: сообщения по клику (GET), переименование (PATCH) и удаление
// (DELETE). Всё с проверкой владения — чужой диалог не отдаём/не трогаем.

const TITLE_MAX = 80;

export type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Вложения (картинки/PDF): ключи файлов, URL строит клиент по projectId. */
  attachments?: { key: string; name: string; mime: string }[];
  createdAt: string;
};

// Проверка владения: диалог существует и принадлежит юзеру. Возвращаем userId-флаг
// раздельно от 404, чтобы не палить существование чужих диалогов (отвечаем 404).
async function assertOwned(id: string, userId: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  return Boolean(conv && conv.userId === userId);
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);
  if (!(await assertOwned(params.id, user.id))) return apiError("Not found", 404);

  const rows = await prisma.message.findMany({
    where: { conversationId: params.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, attachments: true, createdAt: true },
  });

  const messages: ApiMessage[] = rows.map((m) => {
    const att = parseChatAttachments(m.attachments);
    return {
      id: m.id,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      ...(att.length ? { attachments: att } : {}),
      createdAt: m.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ messages });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);
  if (!(await assertOwned(params.id, user.id))) return apiError("Not found", 404);

  const body = await readJson(req);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, TITLE_MAX) : "";
  if (!title) return apiError("Пустой заголовок");

  await prisma.conversation.update({
    where: { id: params.id },
    data: { title },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);
  if (!(await assertOwned(params.id, user.id))) return apiError("Not found", 404);

  // Сообщения удалятся каскадом (onDelete: Cascade).
  await prisma.conversation.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
