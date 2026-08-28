import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/http";
import { notifySupportMessage } from "@/lib/telegram";
import {
  readSupportPayload,
  saveSupportAttachments,
  toSupportRow,
  SUPPORT_MESSAGE_SELECT,
} from "@/lib/support-server";

// Чат техподдержки со стороны КЛИЕНТА (один тред на юзера).
// GET  — вся переписка; заодно помечает ответы поддержки прочитанными
//        (по ним считается бейдж непрочитанных на кнопке в сайдбаре).
// POST — новое сообщение от клиента + уведомление в телеграм-бот.

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const messages = await prisma.supportMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: SUPPORT_MESSAGE_SELECT,
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

  return NextResponse.json({ messages: messages.map(toSupportRow) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  // Тело может прийти и как JSON, и как multipart (когда приложили скриншоты).
  const payload = await readSupportPayload(req);
  if (!payload.ok) return apiError(payload.error, 400);
  const { content, files } = payload;

  // ⚠️ Файлы пишем ДО создания строки: упадёт запись на диск (нет прав на папку
  // загрузок — на этом уже горели с превью) — человек увидит честную ошибку, а
  // не сообщение в переписке со «сломанными» картинками.
  let attachments;
  try {
    attachments = await saveSupportAttachments(files, user.id);
  } catch (err) {
    console.error("[support] не удалось сохранить вложение:", err);
    return apiError("Не удалось сохранить картинку. Попробуйте ещё раз", 500);
  }

  const created = await prisma.supportMessage.create({
    data: {
      userId: user.id,
      role: "user",
      content,
      attachments: attachments.length
        ? (attachments as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
    select: SUPPORT_MESSAGE_SELECT,
  });

  // Уведомление админам. Best-effort: сообщение уже в БД и видно в /admin/support,
  // поэтому падение телеграма не должно ломать отправку для пользователя.
  void notifySupportMessage({
    userId: user.id,
    name: user.name,
    email: user.email,
    // ⚠️ Картинку в телеграм не шлём (файл лежит на диске, sendPhoto потребовал
    // бы отдельной загрузки), но О НАЛИЧИИ говорим: иначе админ прочитает голое
    // «вот, смотрите» и не поймёт, что смотреть надо в админке.
    // ⚠️⚠️ БЕЗ эмодзи: символ вне BMP внутри шаблонной строки ломается
    // минификатором SWC (см. EMOJI в lib/telegram.ts — там из-за этого в чат
    // улетал текст вида 💰 вместо значка).
    content: attachments.length
      ? [content || "(без текста)", "", `Приложено картинок: ${attachments.length}`].join("\n")
      : content,
  }).catch((err) => console.error("[support] telegram notify error:", err));

  return NextResponse.json({ message: toSupportRow(created) });
}
