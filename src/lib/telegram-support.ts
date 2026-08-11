import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

// Связывание аккаунта с личкой бота поддержки (@velizhaninai_support_bot).
//
// Как это работает:
//  1. На сайте кнопка «Поддержка в Telegram» дёргает GET /api/support/telegram
//     и получает ссылку вида https://t.me/<bot>?start=<токен>.
//  2. Человек жмёт «Start», Telegram присылает боту `/start <токен>`.
//  3. Вебхук (/api/telegram/webhook) находит по токену юзера и запоминает его
//     chat_id — дальше всё, что он пишет боту, попадает в ту же переписку
//     поддержки, что и сообщения с сайта, а ответы админа уходят ему в личку.
//
// ⚠️ Токен одноразовый и живёт час: ссылка попадает в историю Telegram и в буфер
// обмена, а привязка чужого чата к аккаунту дала бы доступ к переписке.
// В БД лежит ХЭШ (как у токенов подтверждения почты), в ссылку уходит сырой.

export const SUPPORT_BOT = "velizhaninai_support_bot";
const TOKEN_TYPE = "tg_support_link";
const TOKEN_TTL_MS = 60 * 60 * 1000;

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Ссылка на бота с одноразовым токеном. Payload в deep link ограничен 64
// символами и допускает только [A-Za-z0-9_-], поэтому base64url от 24 байт.
export async function createSupportLink(userId: string): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  await prisma.verificationToken.create({
    data: {
      tokenHash: hash(raw),
      type: TOKEN_TYPE,
      userId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return `https://t.me/${SUPPORT_BOT}?start=${raw}`;
}

// Разобрать токен из /start и связать чат с аккаунтом. Возвращает имя юзера,
// если связали, иначе null (токен неизвестен или протух).
export async function linkChatByToken(
  raw: string,
  chatId: string
): Promise<{ userId: string; name: string | null } | null> {
  const row = await prisma.verificationToken.findFirst({
    where: { tokenHash: hash(raw), type: TOKEN_TYPE, expiresAt: { gt: new Date() } },
  });
  if (!row?.userId) return null;

  // Токен одноразовый — гасим сразу, даже если дальше что-то пойдёт не так.
  await prisma.verificationToken.deleteMany({ where: { id: row.id } });

  // Тот же чат мог быть привязан к другому аккаунту (человек перелогинился) —
  // снимаем старую привязку, иначе упрёмся в уникальный индекс.
  await prisma.user.updateMany({
    where: { telegramChatId: chatId, id: { not: row.userId } },
    data: { telegramChatId: null },
  });

  const user = await prisma.user.update({
    where: { id: row.userId },
    data: { telegramChatId: chatId },
    select: { id: true, name: true },
  });
  return { userId: user.id, name: user.name };
}

export async function userByChat(chatId: string) {
  return prisma.user.findUnique({ where: { telegramChatId: chatId } });
}
