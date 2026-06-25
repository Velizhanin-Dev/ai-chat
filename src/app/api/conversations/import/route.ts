import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

// Разовая миграция истории из localStorage в БД (см. chat-client.migrateLocalConversations).
// Клиент шлёт диалоги со старого устройства/браузера, мы создаём их под текущего
// юзера. Идемпотентно: диалог с уже существующим id пропускаем (не дублируем при
// повторном запуске миграции). Чужие id (есть, но другой userId) тоже пропускаем.

const TITLE_MAX = 80;
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 500;

type InMessage = { role: unknown; content: unknown; createdAt: unknown };
type InConversation = {
  id: unknown;
  title: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  messages: unknown;
};

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите", 401);

  const body = await readJson(req);
  const raw = Array.isArray(body?.conversations) ? (body!.conversations as InConversation[]) : null;
  if (!raw) return apiError("Некорректный запрос");

  let imported = 0;
  for (const c of raw.slice(0, MAX_CONVERSATIONS)) {
    const id = typeof c?.id === "string" ? c.id : null;
    if (!id) continue;

    // Уже есть такой id — пропускаем (идемпотентность + не перетираем чужое).
    const existing = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing) continue;

    const msgs = Array.isArray(c.messages) ? (c.messages as InMessage[]) : [];
    const messages = msgs
      .slice(0, MAX_MESSAGES)
      .filter(
        (m) =>
          (m?.role === "user" || m?.role === "assistant") &&
          typeof m?.content === "string" &&
          m.content.trim().length > 0
      )
      .map((m) => ({
        role: m.role as string,
        content: (m.content as string).slice(0, 100_000),
        createdAt: parseDate(m.createdAt) ?? new Date(),
      }));

    if (messages.length === 0) continue; // пустые диалоги не тащим

    const title = typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, TITLE_MAX) : "Новый чат";
    const createdAt = parseDate(c.createdAt);
    const updatedAt = parseDate(c.updatedAt);

    await prisma.conversation.create({
      data: {
        id,
        userId: user.id,
        title,
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        messages: { create: messages },
      },
    });
    imported += 1;
  }

  return NextResponse.json({ imported });
}
