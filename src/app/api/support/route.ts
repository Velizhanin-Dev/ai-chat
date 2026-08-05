import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { notifySupportMessage } from "@/lib/telegram";
import {
  normalizeSupportRole,
  sanitizeSupportContent,
  type SupportMessageRow,
} from "@/lib/support";

// Чат техподдержки со стороны КЛИЕНТА (один тред на юзера).
// GET  — вся переписка; заодно помечает ответы поддержки прочитанными
//        (по ним считается бейдж непрочитанных на кнопке в сайдбаре).
// POST — новое сообщение от клиента + уведомление в телеграм-бот.

function toRow(m: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}): SupportMessageRow {
  return {
    id: m.id,
    role: normalizeSupportRole(m.role),
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const messages = await prisma.supportMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  // Прочитанными помечаем, только когда вкладку РЕАЛЬНО смотрят: страница
  // поллит переписку в фоне, и без этого ответ поддержки «читался» сам собой в
  // свёрнутой вкладке — бейдж непрочитанных не появлялся никогда. Клиент шлёт
  // ?read=0, если документ скрыт (см. support-client). По умолчанию — читаем.
  const read = new URL(req.url).searchParams.get("read") !== "0";
  if (read) {
    // Fire-and-forget: на отдачу сообщений не влияет.
    void prisma.supportMessage
      .updateMany({
        where: { userId: user.id, role: "admin", readAt: null },
        data: { readAt: new Date() },
      })
      .catch((err) => console.error("[support] mark read error:", err));
  }

  return NextResponse.json({ messages: messages.map(toRow) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const content = sanitizeSupportContent(body?.content);
  if (!content) return apiError("Пустое сообщение", 400);

  const created = await prisma.supportMessage.create({
    data: { userId: user.id, role: "user", content },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  // Уведомление админам. Best-effort: сообщение уже в БД и видно в /admin/support,
  // поэтому падение телеграма не должно ломать отправку для пользователя.
  void notifySupportMessage({
    userId: user.id,
    name: user.name,
    email: user.email,
    content,
  }).catch((err) => console.error("[support] telegram notify error:", err));

  return NextResponse.json({ message: toRow(created) });
}
