import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/settings";
import { getPlans } from "@/lib/plans";

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
// ⚠️ КАК ЭТО РАБОТАЕТ (важно, легко сломать «упрощением»):
// POST НЕ обнуляет всех разом. Он ставит МЕТКУ времени (AppSettings.trialResetAt),
// а пробный период выдаётся каждому персонально — при его первом заходе после
// метки (maybeGrantTrial в quota.ts, вызывается из getSessionUser).
//
// Почему не updateMany: тогда срок считался бы от нажатия кнопки. Нажали в 11:00
// при сроке 3 часа — в 14:00 у всех истекло, и человек, открывший письмо в 15:00,
// упирается в закрытую дверь. С меткой он получает свои полные 3 часа в 15:00.
//
// GET — сколько людей метка затронет (для подтверждения в интерфейсе).

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
  const [count, settings] = await Promise.all([
    prisma.user.count({ where }),
    saveSettings({ trialResetAt: new Date().toISOString() }),
  ]);

  console.log(
    `[admin] метка сброса пробных периодов поставлена (${count} чел. получат ${settings.trialHours} ч при заходе, админ ${admin.email})`
  );
  return NextResponse.json({ count, trialHours: settings.trialHours });
}
