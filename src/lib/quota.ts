import type { User } from "@prisma/client";
import { getPlans, type PublicPlan } from "./plans";

// ── Квоты запросов и срок тарифа ────────────────────────────────────────────
// Один ответ ассистента (kind=chat, без классификации) = 1 единица лимита.
// Лимит периода берётся из Plan.limits.requests (-1 = без лимита), редактируется
// в админке — включая пробный тариф. Доступ к ассистенту = тариф не истёк И
// квота не исчерпана. Счётчик израсходованного — User.requestsUsed (сбрасывается
// при выдаче/смене тарифа). Источник правды — сервер (см. /api/chat).

// Пробный тариф выдаётся при регистрации ВСЕГО на 1 час (срок), а число запросов
// в этот час — из Plan.limits.requests для тарифа "start" (правится в админке).
export const TRIAL_PLAN_ID = "start";
export const TRIAL_DURATION_MS = 60 * 60 * 1000; // 1 час

// Момент окончания пробного тарифа от «сейчас» (или от заданной точки).
export function trialExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DURATION_MS);
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
