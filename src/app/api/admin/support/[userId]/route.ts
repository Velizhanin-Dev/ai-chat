import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/http";
import { sendToChat, escapeHtml } from "@/lib/telegram";
import {
  readSupportPayload,
  saveSupportAttachments,
  toSupportRow,
  SUPPORT_MESSAGE_SELECT,
} from "@/lib/support-server";

// Переписка с конкретным пользователем в админке.
// GET  — вся история; заодно помечает вопросы юзера прочитанными (счётчик в списке).
// POST — ответ поддержки (появится у юзера в его окне «Нужна помощь?»).

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
    select: SUPPORT_MESSAGE_SELECT,
  });

  // Админ открыл тред — вопросы считаются прочитанными (fire-and-forget).
  void prisma.supportMessage
    .updateMany({
      where: { userId: user.id, role: "user", readAt: null },
      data: { readAt: new Date() },
    })
    .catch((err) => console.error("[admin/support] mark read error:", err));

  return NextResponse.json({ user, messages: messages.map(toSupportRow) });
}

export async function POST(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  // Как и у клиента: JSON или multipart. Админу вложения нужны не меньше —
  // показать «нажми вот сюда» картинкой быстрее, чем описывать словами.
  const payload = await readSupportPayload(req);
  if (!payload.ok) return apiError(payload.error, 400);
  const { content, files } = payload;

  const exists = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, telegramChatId: true },
  });
  if (!exists) return apiError("Пользователь не найден", 404);

  let attachments;
  try {
    // Кладём в папку ВЛАДЕЛЬЦА треда, а не админа: это части одного обращения.
    attachments = await saveSupportAttachments(files, exists.id);
  } catch (err) {
    console.error("[admin/support] не удалось сохранить вложение:", err);
    return apiError("Не удалось сохранить картинку", 500);
  }

  const created = await prisma.supportMessage.create({
    data: {
      userId: exists.id,
      role: "admin",
      content,
      attachments: attachments.length
        ? (attachments as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
    select: SUPPORT_MESSAGE_SELECT,
  });

  // Человек писал из Telegram — ответ должен прийти туда же, а не только на сайт.
  // Best-effort: ответ уже сохранён, падение телеграма его не отменяет.
  if (exists.telegramChatId) {
    // ⚠️ Картинки в телеграм не уходят (файл на диске), поэтому если ответ ТОЛЬКО
    // из картинок, человек в телеграме увидел бы пустое сообщение — зовём на сайт.
    const tgText = attachments.length
      ? [
          content || "Ответили картинкой.",
          "",
          "Смотрите в разделе «Нужна помощь?» на сайте.",
        ].join("\n")
      : content;
    void sendToChat(
      exists.telegramChatId,
      `<b>Поддержка VELIZHANIN AI</b>

${escapeHtml(tgText)}`
    ).catch(() => {});
  }

  return NextResponse.json({ message: toSupportRow(created) });
}
