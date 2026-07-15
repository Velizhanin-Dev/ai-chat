import crypto from "crypto";

// ── CloudPayments: оплата зарубежными картами (Visa/Mastercard и т.д.) ──────────
// Второй провайдер оплаты рядом с ТБанк (рос. карты/СБП/Мир). Интеграция —
// клиентский виджет (cp.CloudPayments().pay('charge', …)) + серверный вебхук Pay
// для подтверждения. Ключи: NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID (клиент, виджет) и
// CLOUDPAYMENTS_API_SECRET (сервер: HMAC вебхука + вызовы API). Док: developers.cloudpayments.ru.

const BASE = (process.env.CLOUDPAYMENTS_API_URL || "https://api.cloudpayments.ru").replace(/\/+$/, "");

export function cloudpaymentsPublicId(): string {
  return process.env.NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID || "";
}
function apiSecret(): string {
  return process.env.CLOUDPAYMENTS_API_SECRET || "";
}
export function cloudpaymentsConfigured(): boolean {
  return Boolean(cloudpaymentsPublicId() && apiSecret());
}

// Проверка подписи вебхука CloudPayments: Base64(HMAC-SHA256(rawBody, apiSecret))
// сверяем с заголовком Content-HMAC. Сравнение постоянного времени. rawBody — СЫРОЕ
// тело запроса (как пришло), поэтому в роуте читаем req.text() до парсинга.
export function verifyCloudHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = apiSecret();
  if (!secret || !hmacHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface CloudFindResult {
  ok: boolean; // удалось ли обратиться к API (не про статус платежа)
  status?: string; // "Completed" | "Declined" | "Cancelled" | …
  transactionId?: string;
}

// Найти последнюю транзакцию по нашему InvoiceId (= id платежа) — для синхронизации
// статуса на возврате, когда вебхук ещё не дошёл (аналог GetState у ТБанк).
export async function cloudFindByInvoice(invoiceId: string): Promise<CloudFindResult> {
  if (!cloudpaymentsConfigured()) return { ok: false };
  try {
    const auth = Buffer.from(`${cloudpaymentsPublicId()}:${apiSecret()}`).toString("base64");
    const res = await fetch(`${BASE}/v2/payments/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ InvoiceId: invoiceId }),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      Success?: boolean;
      Model?: { Status?: string; TransactionId?: number };
    };
    if (!data.Success || !data.Model) return { ok: true }; // транзакции ещё нет — не ошибка
    return {
      ok: true,
      status: data.Model.Status,
      transactionId: data.Model.TransactionId != null ? String(data.Model.TransactionId) : undefined,
    };
  } catch {
    return { ok: false };
  }
}

// Параметры для клиентского виджета CloudPayments (то, что отдаём на клиент).
export interface CloudPaymentParams {
  publicId: string;
  invoiceId: string; // = id нашего платежа (по нему матчим вебхук/синк)
  amount: number; // в рублях (у виджета сумма в основной единице валюты)
  currency: string; // "RUB"
  description: string;
  accountId: string; // userId
  email: string;
}
