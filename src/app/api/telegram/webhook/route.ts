import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToChat, notifySupportMessage } from "@/lib/telegram";
import { linkChatByToken, userByChat } from "@/lib/telegram-support";
import { SUPPORT_MAX_LENGTH } from "@/lib/support";

// Вебхук бота поддержки (@velizhaninai_support_bot).
//
// Что делает:
//  • /start <токен> — связывает чат с аккаунтом (токен выдаёт кнопка на сайте);
//  • любое другое сообщение из связанного чата — кладёт в ту же переписку
//    поддержки, что и сообщения с сайта (SupportMessage, role="user"), и шлёт
//    уведомление в админский чат. Отвечает админ в /admin/support, как обычно.
//
// ⚠️ Эндпоинт ПУБЛИЧНЫЙ (его дёргает Telegram), поэтому защищён секретом:
// при установке вебхука передаём secret_token, Telegram шлёт его заголовком
// X-Telegram-Bot-Api-Secret-Token. Без совпадения — 401 и ничего не делаем.
//
// ⚠️ Всегда отвечаем 200 на распознанные апдейты: на не-2xx Telegram будет
// повторять доставку и в итоге отключит вебхук.

export const dynamic = "force-dynamic";

interface TgUpdate {
  message?: {
    chat?: { id?: number | string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[telegram] TELEGRAM_WEBHOOK_SECRET не задан — вебхук отключён");
    return NextResponse.json({ ok: true });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  const chat = String(chatId);

  // Привязка аккаунта: /start <токен>
  if (text.startsWith("/start")) {
    const payload = text.slice("/start".length).trim();
    if (!payload) {
      await sendToChat(
        chat,
        "Привет! Чтобы я знал, чей это аккаунт, откройте поддержку на сайте и нажмите кнопку «Поддержка в Telegram» — она приведёт вас сюда уже со связкой."
      );
      return NextResponse.json({ ok: true });
    }
    const linked = await linkChatByToken(payload, chat);
    await sendToChat(
      chat,
      linked
        ? `Готово${linked.name ? `, ${linked.name}` : ""}. Пишите прямо сюда — отвечу здесь же.`
        : "Ссылка устарела. Откройте поддержку на сайте и нажмите кнопку «Поддержка в Telegram» ещё раз."
    );
    return NextResponse.json({ ok: true });
  }

  // Обычное сообщение: пишем в переписку поддержки от имени связанного юзера.
  const user = await userByChat(chat);
  if (!user) {
    await sendToChat(
      chat,
      "Не понимаю, чей это аккаунт. Откройте поддержку на сайте и нажмите «Поддержка в Telegram» — тогда я свяжу этот чат с вашим профилем."
    );
    return NextResponse.json({ ok: true });
  }

  const content = text.slice(0, SUPPORT_MAX_LENGTH);
  await prisma.supportMessage.create({
    data: { userId: user.id, role: "user", content },
  });

  // Уведомление админу — то же самое, что при вопросе с сайта.
  void notifySupportMessage({
    userId: user.id,
    name: user.name ?? "",
    email: user.email,
    content,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
