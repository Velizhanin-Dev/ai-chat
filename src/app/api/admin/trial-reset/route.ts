import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { getPlans } from "@/lib/plans";
import { trialExpiresAt } from "@/lib/quota";

// Массовый сброс пробных периодов (кнопка в админке).
//
// Зачем: перед запуском / рассылкой владелец хочет, чтобы все, кто пробовал и не
// заплатил, получили пробный период заново — зашёл человек по письму, а у него
// снова есть доступ. Заново триал сам по себе не выдаётся (иначе его можно было бы
// накручивать перерегистрацией), поэтому это ручное действие админа.
//
// ⚠️ Кого НЕ трогаем:
//  • тех, кто хоть раз платил (есть платёж со статусом CONFIRMED) — у них может
//    идти оплаченный срок, и обнулять его нельзя;
//  • тех, кто сидит на ПЛАТНОМ тарифе (priceRub > 0), даже без платежа в базе:
//    тариф мог быть выдан руками из админки, это не пробный период.
//
// GET — посчитать, скольких это затронет (для подтверждения в интерфейсе).
// POST — собственно сброс.

export const dynamic = "force-dynamic";

// Кому положен сброс. Условие одно на оба метода — иначе цифра в подтверждении
// разъезжалась бы с тем, что реально произойдёт.
async function eligibleWhere() {
  const plans = await getPlans();
  // Бесплатные тарифы = пробные. Тариф может быть архивным — его тоже учитываем
  // (человек на архивном триале всё равно пробный).
  const freePlanIds = plans.filter((p) => p.priceRub === 0).map((p) => p.id);
  return {
    plan: { in: freePlanIds },
    payments: { none: { status: "CONFIRMED" } },
  } as const;
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const where = await eligibleWhere();
  const [count, settings] = await Promise.all([
    prisma.user.count({ where }),
    getSettings(),
  ]);
  return NextResponse.json({ count, trialHours: settings.trialHours });
}

export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const where = await eligibleWhere();
  const settings = await getSettings();

  // Сбрасываем ОБЕ границы доступа сразу: и срок, и израсходованные запросы.
  // Сбросить только срок мало — у человека с исчерпанной квотой доступа всё равно
  // не будет, и он решит, что письмо соврало.
  const res = await prisma.user.updateMany({
    where,
    data: {
      planExpiresAt: trialExpiresAt(settings.trialHours),
      requestsUsed: 0,
    },
  });

  console.log(
    `[admin] пробный период сброшен у ${res.count} юзеров на ${settings.trialHours} ч (админ ${admin.email})`
  );
  return NextResponse.json({ count: res.count, trialHours: settings.trialHours });
}
