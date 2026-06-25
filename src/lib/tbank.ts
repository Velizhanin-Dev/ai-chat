import { createHash } from "crypto";

// ── Клиент эквайринга ТБанк (E-ACQ / Tinkoff Acquiring) ─────────────────────
// Схема: POST {API}/Init → получаем PaymentURL → редиректим клиента на платёжную
// страницу ТБанк → ТБанк шлёт webhook на NotificationURL со статусом и Token, плюс
// возвращает юзера на SuccessURL/FailURL. Факт оплаты подтверждаем по статусу
// CONFIRMED (вебхук + синхронизация через GetState на возврате).
//
// Подпись (Token): берём КОРНЕВЫЕ скалярные поля запроса (без вложенных объектов
// Receipt/DATA и без самого Token), добавляем пару {Password}, сортируем по ключу,
// склеиваем значения в одну строку и берём SHA-256 (hex). Тем же алгоритмом
// проверяем Token во входящем уведомлении.

const API = (process.env.TBANK_API_URL || "https://securepay.tinkoff.ru/v2").replace(/\/$/, "");
const TERMINAL = process.env.TBANK_TERMINAL_KEY || "";
const PASSWORD = process.env.TBANK_PASSWORD || "";

export function tbankConfigured(): boolean {
  return Boolean(TERMINAL && PASSWORD);
}

// Подпись запроса/уведомления. Сортировка ординальная (по charCode), как на стороне
// ТБанк; булевы → "true"/"false"; объекты/массивы/undefined/null не участвуют.
export function buildToken(params: Record<string, unknown>, password = PASSWORD): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === "Token") continue;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") continue; // Receipt, DATA, Items — вне подписи
    entries.push([k, typeof v === "boolean" ? (v ? "true" : "false") : String(v)]);
  }
  entries.push(["Password", password]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const concat = entries.map(([, val]) => val).join("");
  return createHash("sha256").update(concat, "utf8").digest("hex");
}

// Проверка Token входящего webhook-уведомления.
export function verifyNotificationToken(body: Record<string, unknown>): boolean {
  const received = String(body.Token || "");
  if (!received || !PASSWORD) return false;
  return received.toLowerCase() === buildToken(body).toLowerCase();
}

// ── Чек 54-ФЗ (Receipt) ─────────────────────────────────────────────────────
export interface TbankReceiptItem {
  Name: string;
  Price: number; // копейки
  Quantity: number;
  Amount: number; // копейки = Price * Quantity
  Tax: string; // ставка НДС: none | vat0 | vat10 | vat20 | …
  PaymentMethod?: string;
  PaymentObject?: string;
}
export interface TbankReceipt {
  Email?: string;
  Phone?: string;
  Taxation: string; // система налогообложения: usn_income | osn | …
  Items: TbankReceiptItem[];
  FfdVersion?: string;
}

// ── Init ────────────────────────────────────────────────────────────────────
export interface InitParams {
  amount: number; // копейки
  orderId: string;
  description?: string;
  customerKey?: string;
  recurrent?: boolean; // Recurrent=Y → регистрируем RebillId для будущих автосписаний
  notificationURL?: string;
  successURL?: string;
  failURL?: string;
  receipt?: TbankReceipt;
}

export interface TbankInitResult {
  ok: boolean;
  paymentId?: string;
  paymentURL?: string;
  status?: string;
  error?: string;
}

interface TbankResponse {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  Status?: string;
  PaymentId?: string | number;
  PaymentURL?: string;
  RebillId?: string | number;
}

async function call(method: string, body: Record<string, unknown>): Promise<TbankResponse> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json().catch(() => ({}))) as TbankResponse;
}

function errText(d: TbankResponse): string {
  return d.Message || d.Details || `Ошибка ТБанк${d.ErrorCode ? ` (код ${d.ErrorCode})` : ""}`;
}

export async function tbankInit(p: InitParams): Promise<TbankInitResult> {
  if (!tbankConfigured()) return { ok: false, error: "Эквайринг не настроен" };

  const body: Record<string, unknown> = {
    TerminalKey: TERMINAL,
    Amount: p.amount,
    OrderId: p.orderId,
  };
  if (p.description) body.Description = p.description.slice(0, 250);
  if (p.customerKey) body.CustomerKey = p.customerKey;
  if (p.recurrent) body.Recurrent = "Y";
  if (p.notificationURL) body.NotificationURL = p.notificationURL;
  if (p.successURL) body.SuccessURL = p.successURL;
  if (p.failURL) body.FailURL = p.failURL;
  // Token считаем по скалярам (Receipt — объект, в подпись не входит).
  body.Token = buildToken(body);
  if (p.receipt) body.Receipt = p.receipt;

  try {
    const d = await call("Init", body);
    if (!d.Success || !d.PaymentURL) return { ok: false, error: errText(d) };
    return { ok: true, paymentId: String(d.PaymentId), paymentURL: d.PaymentURL, status: d.Status };
  } catch (e) {
    console.error("[tbank] Init failed:", e);
    return { ok: false, error: "Нет связи с ТБанк" };
  }
}

export interface TbankStateResult {
  ok: boolean;
  status?: string;
  rebillId?: string;
  error?: string;
}

export async function tbankGetState(paymentId: string): Promise<TbankStateResult> {
  if (!tbankConfigured()) return { ok: false, error: "Эквайринг не настроен" };
  const body: Record<string, unknown> = { TerminalKey: TERMINAL, PaymentId: paymentId };
  body.Token = buildToken(body);
  try {
    const d = await call("GetState", body);
    if (!d.Success) return { ok: false, error: errText(d) };
    return { ok: true, status: d.Status, rebillId: d.RebillId ? String(d.RebillId) : undefined };
  } catch (e) {
    console.error("[tbank] GetState failed:", e);
    return { ok: false, error: "Нет связи с ТБанк" };
  }
}
