import { verifyCloudHmac } from "@/lib/cloudpayments";
import { handleCloudNotification } from "@/lib/billing";

// Вебхук Pay CloudPayments: уведомление об успешной оплате (зарубежная карта).
// Публичный (вызывает сервер CloudPayments), подлинность — по HMAC (Content-HMAC =
// Base64(HMAC-SHA256(rawBody, apiSecret))). Ответ: JSON {"code":0} = принято,
// иначе CloudPayments считает обработку неуспешной. Тело — form-urlencoded (по
// умолчанию) или JSON; HMAC считается по СЫРОМУ телу, поэтому читаем text() до парсинга.
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("Content-HMAC") || req.headers.get("X-Content-HMAC");

  if (!verifyCloudHmac(raw, hmac)) {
    console.warn("[cloudpayments] webhook: bad HMAC");
    return Response.json({ code: 13 });
  }

  // CloudPayments по умолчанию шлёт application/x-www-form-urlencoded.
  let body: Record<string, unknown>;
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      body = JSON.parse(raw) as Record<string, unknown>;
    } else {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    return Response.json({ code: 13 });
  }

  try {
    await handleCloudNotification(body);
  } catch (e) {
    console.error("[cloudpayments] webhook handler failed:", e);
    return Response.json({ code: 13 });
  }
  return Response.json({ code: 0 });
}
