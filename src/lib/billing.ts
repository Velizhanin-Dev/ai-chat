import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { getPlans, type PublicPlan } from "./plans";
import {
  tbankInit,
  tbankGetState,
  tbankConfigured,
  type TbankReceipt,
} from "./tbank";

// ── Биллинг: разовая оплата подписки через ТБанк ────────────────────────────
// MVP: оплата даёт доступ на PERIOD_DAYS дней (продление — новый платёж). При
// первом платеже регистрируем RebillId (Recurrent=Y) — задел под автосписание.
// Факт оплаты = статус CONFIRMED (вебхук + синхронизация GetState на возврате).

const PERIOD_DAYS = 30;
const PAID_STATUSES = ["CONFIRMED"];
const FAILED_STATUSES = ["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "AUTH_FAIL"];

function buildReceipt(plan: PublicPlan, email: string, amount: number): TbankReceipt {
  return {
    Email: email || undefined,
    Taxation: process.env.TBANK_TAXATION || "usn_income",
    ...(process.env.TBANK_FFD_VERSION ? { FfdVersion: process.env.TBANK_FFD_VERSION } : {}),
    Items: [
      {
        Name: `Подписка «${plan.label}», ${PERIOD_DAYS} дней`.slice(0, 128),
        Price: amount,
        Quantity: 1,
        Amount: amount,
        Tax: process.env.TBANK_VAT || "none",
        PaymentMethod: "full_payment",
        PaymentObject: "service",
      },
    ],
  };
}

export interface CreatePaymentResult {
  ok: boolean;
  url?: string;
  error?: string;
}

// Создать платёж: строка Payment(NEW) → Init в ТБанк → ссылка на оплату.
export async function createPayment(user: User, planId: string): Promise<CreatePaymentResult> {
  if (!tbankConfigured()) return { ok: false, error: "Оплата временно недоступна" };

  const plan = (await getPlans()).find((p) => p.id === planId);
  if (!plan || !plan.active) return { ok: false, error: "Тариф не найден" };
  if (plan.priceRub <= 0) return { ok: false, error: "Перейти на бесплатный тариф нельзя" };

  const amount = plan.priceRub * 100; // копейки
  const payment = await prisma.payment.create({
    data: { userId: user.id, planId, amount, status: "NEW" },
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const init = await tbankInit({
    amount,
    orderId: payment.id, // id используем как OrderId
    description: `Тариф «${plan.label}» — ${PERIOD_DAYS} дней`,
    customerKey: user.id,
    recurrent: true,
    notificationURL: `${appUrl}/api/payments/webhook`,
    successURL: `${appUrl}/chat?payment=success&order=${payment.id}`,
    failURL: `${appUrl}/chat?payment=fail`,
    receipt: buildReceipt(plan, user.email, amount),
  });

  if (!init.ok || !init.paymentURL) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "REJECTED" } });
    return { ok: false, error: init.error || "Не удалось создать платёж" };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { tbankPaymentId: init.paymentId },
  });
  return { ok: true, url: init.paymentURL };
}

// Применить успешный платёж: ставим план + срок, сохраняем rebillId. Идемпотентно
// (повторный вебхук/синхронизация не продлевают второй раз).
async function markPaid(paymentId: string, rebillId?: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "CONFIRMED") return;

  const expires = new Date(Date.now() + PERIOD_DAYS * 86400000);
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CONFIRMED", paidAt: new Date(), rebillId: rebillId ?? payment.rebillId },
    }),
    prisma.user.update({
      where: { id: payment.userId },
      data: {
        plan: payment.planId,
        planExpiresAt: expires,
        ...(rebillId ? { rebillId } : {}),
      },
    }),
  ]);
}

// Обработка webhook-уведомления (Token уже проверен в роуте). Возвращает true,
// если уведомление распознано (платёж найден).
export async function handleNotification(body: Record<string, unknown>): Promise<boolean> {
  const orderId = String(body.OrderId || "");
  const status = String(body.Status || "");
  if (!orderId) return false;

  const payment = await prisma.payment.findUnique({ where: { id: orderId } });
  if (!payment) return false;

  if (PAID_STATUSES.includes(status)) {
    await markPaid(payment.id, body.RebillId ? String(body.RebillId) : undefined);
  } else if (FAILED_STATUSES.includes(status) && payment.status === "NEW") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status } });
  }
  return true;
}

// Синхронизация на возврате (SuccessURL): спрашиваем GetState и применяем оплату,
// если CONFIRMED. Нужно, чтобы оплата отражалась даже если вебхук не дошёл
// (например, в dev/песочнице, где NotificationURL недоступен из интернета).
export async function syncPayment(paymentId: string, userId: string): Promise<string | null> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.userId !== userId) return null;
  if (payment.status === "CONFIRMED") return "CONFIRMED";
  if (!payment.tbankPaymentId) return payment.status;

  const st = await tbankGetState(payment.tbankPaymentId);
  if (!st.ok || !st.status) return payment.status;
  if (PAID_STATUSES.includes(st.status)) {
    await markPaid(payment.id, st.rebillId);
    return "CONFIRMED";
  }
  if (FAILED_STATUSES.includes(st.status) && payment.status === "NEW") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: st.status } });
  }
  return st.status;
}
