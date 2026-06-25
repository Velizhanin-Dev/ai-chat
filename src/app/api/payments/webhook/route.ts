import { verifyNotificationToken } from "@/lib/tbank";
import { handleNotification } from "@/lib/billing";

// Webhook ТБанк: уведомления о смене статуса платежа. Публичный (вызывает сервер
// ТБанк), подлинность — по Token. На успех отвечаем телом "OK" (иначе ТБанк будет
// повторять доставку). Источник правды по оплате (вместе с GetState-синхронизацией).
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("ERROR", { status: 400 });
  }

  if (!verifyNotificationToken(body)) {
    console.warn("[payments] webhook: bad token", { orderId: body?.OrderId });
    return new Response("ERROR", { status: 403 });
  }

  try {
    await handleNotification(body);
  } catch (e) {
    console.error("[payments] webhook handler failed:", e);
    return new Response("ERROR", { status: 500 });
  }
  return new Response("OK");
}
