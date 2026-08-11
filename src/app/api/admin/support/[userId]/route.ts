import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { sendToChat, escapeHtml } from "@/lib/telegram";
import {
  normalizeSupportRole,
  sanitizeSupportContent,
  type SupportMessageRow,
} from "@/lib/support";

// Переписка с конкретным пользователем в админке.
// GET  — вся история; заодно помечает вопросы юзера прочитанными (счётчик в списке).
// POST — ответ поддержки (появится у юзера в его окне «Нужна помощь?»).

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

export async function GET(
  _req: Request,
  { params }: { params: { userId: string } }
) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, name: true, email: true, plan: true },
  });
  if (!user) return apiError("Пользователь не найден", 404);

  const messages = await prisma.supportMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  // Админ открыл тред — вопросы считаются прочитанными (fire-and-forget).
  void prisma.supportMessage
    .updateMany({
      where: { userId: user.id, role: "user", readAt: null },
      data: { readAt: new Date() },
    })
    .catch((err) => console.error("[admin/support] mark read error:", err));

  return NextResponse.json({ user, messages: messages.map(toRow) });
}

export async function POST(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const body = await readJson(req);
  const content = sanitizeSupportContent(body?.content);
  if (!content) return apiError("Пустое сообщение", 400);

  const exists = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, telegramChatId: true },
  });
  if (!exists) return apiError("Пользователь не найден", 404);

  const created = await prisma.supportMessage.create({
    data: { userId: exists.id, role: "admin", content },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  // Человек писал из Telegram — ответ должен прийти туда же, а не только на сайт.
  // Best-effort: ответ уже сохранён, падение телеграма его не отменяет.
  if (exists.telegramChatId) {
    void sendToChat(
      exists.telegramChatId,
      `<b>Поддержка VELIZHANIN AI</b>

${escapeHtml(content)}`
    ).catch(() => {});
  }

  return NextResponse.json({ message: toRow(created) });
}
