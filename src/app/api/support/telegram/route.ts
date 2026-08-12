import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createSupportLink, SUPPORT_BOT } from "@/lib/telegram-support";

// Ссылка на бота поддержки с одноразовым токеном привязки.
//
// Токен выдаём КАЖДЫЙ раз новый и на час (см. telegram-support.ts): ссылка
// оседает в истории Telegram, а чужая привязка открыла бы доступ к переписке.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Требуется вход", 401);

  // Уже связан — ведём просто в бота, без нового токена.
  if (user.telegramChatId) {
    return NextResponse.json({ url: `https://t.me/${SUPPORT_BOT}`, linked: true });
  }
  return NextResponse.json({ url: await createSupportLink(user.id), linked: false });
}
