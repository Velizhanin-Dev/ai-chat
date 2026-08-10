import type { User } from "@prisma/client";
import { getPlans, type PublicPlan } from "./plans";
import { prisma } from "./prisma";

// ── Квоты запросов и срок тарифа ────────────────────────────────────────────
// Один ответ ассистента (kind=chat, без классификации) = 1 единица лимита.
// Лимит периода берётся из Plan.limits.requests (-1 = без лимита), редактируется
// в админке — включая пробный тариф. Доступ к ассистенту = тариф не истёк И
// квота не исчерпана. Счётчик израсходованного — User.requestsUsed (сбрасывается
// при выдаче/смене тарифа). Источник правды — сервер (см. /api/chat).

// Пробный тариф выдаётся при регистрации на СРОК из настроек (AppSettings.trialHours,
// правится в админке), а число запросов в этот срок — из Plan.limits.requests для
// тарифа "start" (редактор тарифов). Две разные ручки: время и объём.
export const TRIAL_PLAN_ID = "start";
// Дефолт на случай, когда настройки недоступны (и старое поведение — 1 час).
export const TRIAL_DURATION_MS = 60 * 60 * 1000;

// Момент окончания пробного тарифа. hours — из настроек; без него берём дефолт.
export function trialExpiresAt(hours?: number, from: Date = new Date()): Date {
  const ms = hours && hours > 0 ? hours * 60 * 60 * 1000 : TRIAL_DURATION_MS;
  return new Date(from.getTime() + ms);
}

export type QuotaReason = "ok" | "expired" | "quota";

export interface QuotaState {
  plan: string;
  limit: number; // -1 = без лимита
  used: number;
  remaining: number | null; // null = без лимита
  expiresAt: Date | null;
  expired: boolean; // срок тарифа вышел
  quotaExceeded: boolean; // запросы кончились
  ok: boolean; // можно слать запрос
  reason: QuotaReason;
}

// Состояние доступа юзера: срок + остаток запросов. plans можно передать, чтобы
// не дёргать БД дважды (в /api/chat настройки уже читаются отдельно).
export async function getQuotaState(
  user: Pick<User, "plan" | "requestsUsed" | "planExpiresAt">,
  plans?: PublicPlan[]
): Promise<QuotaState> {
  const all = plans ?? (await getPlans());
  const plan = all.find((p) => p.id === user.plan);
  // Неизвестный тариф (битые данные) → лимит 0, доступ закрыт (безопасный дефолт).
  const limit = plan ? plan.limits.requests : 0;
  const used = Math.max(0, user.requestsUsed ?? 0);
  const unlimited = limit === -1;

  const expiresAt = user.planExpiresAt ?? null;
  // null срок = без ограничения по времени (легаси/бессрочно, выставляется вручную).
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  const quotaExceeded = !unlimited && used >= limit;

  let reason: QuotaReason = "ok";
  if (expired) reason = "expired";
  else if (quotaExceeded) reason = "quota";

  return {
    plan: user.plan,
    limit,
    used,
    remaining,
    expiresAt,
    expired,
    quotaExceeded,
    ok: reason === "ok",
    reason,
  };
}

// ── Персональная выдача пробного периода после массового сброса ──────────────
//
// ⚠️ Почему не разовым updateMany по всем юзерам: тогда срок отсчитывался бы от
// момента нажатия кнопки в админке. Нажали в 11:00 при сроке 3 часа — у всех
// истекло в 14:00, и человек, открывший письмо в 15:00, упирается в закрытую
// дверь, хотя ему только что написали «доступ открыт».
//
// Поэтому кнопка ставит только МЕТКУ (AppSettings.trialResetAt), а сам период
// выдаётся здесь — при первом заходе конкретного человека, от его времени.
// Условие выдачи: метка сброса новее, чем последняя выдача этому юзеру
// (User.trialGrantedAt). После выдачи trialGrantedAt = now > метки, поэтому
// повторно не сработает — сколько бы страниц человек ни открыл.
export async function maybeGrantTrial<T extends {
  id: string;
  plan: string;
  planExpiresAt: Date | null;
  trialGrantedAt: Date | null;
}>(user: T, deps: { trialResetAt: string | null; trialHours: number }): Promise<T> {
  const { trialResetAt, trialHours } = deps;
  if (!trialResetAt) return user;

  const resetAt = new Date(trialResetAt);
  if (Number.isNaN(resetAt.getTime())) return user;
  // Уже выдавали после этой метки — ничего не делаем (это самый частый случай,
  // и он не стоит ни одного лишнего запроса).
  if (user.trialGrantedAt && user.trialGrantedAt >= resetAt) return user;

  // Платный тариф не трогаем: сброс — только для пробных. Платившие отсекаются
  // тут же по факту платного тарифа, а тех, кто на бесплатном, но когда-то платил,
  // отсекает проверка платежей ниже.
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === user.plan);
  if (!plan || plan.priceRub > 0) return user;

  const paid = await prisma.payment.count({
    where: { userId: user.id, status: "CONFIRMED" },
  });
  if (paid > 0) return user;

  const now = new Date();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      planExpiresAt: trialExpiresAt(trialHours, now),
      requestsUsed: 0,
      trialGrantedAt: now,
    },
  });
  console.log(`[trial] выдан заново юзеру ${user.id} на ${trialHours} ч`);
  return { ...user, ...updated } as T;
}
