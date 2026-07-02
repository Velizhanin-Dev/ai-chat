import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

// ── Тарифы (редактируемые из админки) ───────────────────────────────────────
// Источник правды — таблица Plan. Лендинг (Pricing) и биллинг в настройках читают
// отсюда. Серверный модуль (Prisma) — не импортировать в клиентские компоненты;
// клиенту отдаём через серверный проп (лендинг) или GET /api/plans (настройки).

// Лимиты тарифа (-1 = без лимита, 0 = не применимо). Правятся в админке.
export interface PlanLimits {
  requests: number; // запросов (1 ответ нейронки = 1 запрос)
  projects: number; // проектов (что такое «проект» — определим позже)
}

export interface PublicPlan {
  id: string;
  label: string;
  priceRub: number;
  period: string;
  features: string[];
  limits: PlanLimits;
  order: number;
  highlighted: boolean;
  active: boolean;
}

const EMPTY_LIMITS: PlanLimits = { requests: 0, projects: 0 };

// Дефолты = текущие захардкоженные тарифы (start/blogger/studio). Используются для
// первичного посева таблицы (idempotent) — дальше правятся из админки.
export const DEFAULT_PLANS: PublicPlan[] = [
  {
    id: "start",
    label: "Пробный",
    priceRub: 0,
    period: "1 час · без карты",
    features: ["12 запросов на пробу", "Голос и методика Николая", "Без оплаты и привязки карты"],
    limits: { ...EMPTY_LIMITS, requests: 12, projects: 1 },
    order: 0,
    highlighted: false,
    active: true,
  },
  {
    id: "blogger",
    label: "Базовый",
    priceRub: 4000,
    period: "в месяц",
    features: ["3 контент-плана", "30 сценариев", "90 шортсов", "Все 100+ форматов и длинные видео"],
    limits: { requests: -1, projects: 5 },
    order: 1,
    highlighted: true,
    active: true,
  },
  {
    id: "studio",
    label: "Максимальный",
    priceRub: 10000,
    period: "в месяц",
    features: ["Контент-планы без лимита", "Сценарии без лимита", "Шортсы без лимита", "Приоритетная поддержка"],
    limits: { requests: -1, projects: -1 },
    order: 2,
    highlighted: false,
    active: true,
  },
];

function normalizeLimits(v: unknown): PlanLimits {
  const o = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.trunc(x) : 0);
  // Старые ключи (contentPlans/scenarios/shorts) в JSON игнорируем. Отсутствующий
  // projects → 0 (старые строки в БД сохранят его при следующем редактировании).
  return { requests: num(o.requests), projects: num(o.projects) };
}

type PlanRow = Prisma.PlanGetPayload<object>;

function toPublic(p: PlanRow): PublicPlan {
  return {
    id: p.id,
    label: p.label,
    priceRub: p.priceRub,
    period: p.period,
    features: Array.isArray(p.features) ? p.features : [],
    limits: normalizeLimits(p.limits),
    order: p.order,
    highlighted: p.highlighted,
    active: p.active,
  };
}

// Idempotent-посев дефолтов, если таблица пуста (первый запуск после миграции).
async function ensureSeeded(): Promise<void> {
  const count = await prisma.plan.count();
  if (count > 0) return;
  await prisma.plan.createMany({
    data: DEFAULT_PLANS.map((p) => ({
      id: p.id,
      label: p.label,
      priceRub: p.priceRub,
      period: p.period,
      features: p.features,
      limits: p.limits as unknown as Prisma.InputJsonValue,
      order: p.order,
      highlighted: p.highlighted,
      active: p.active,
    })),
    skipDuplicates: true,
  });
}

// Все тарифы по порядку (для админки). При сбое БД — дефолты, чтобы не падать.
export async function getPlans(): Promise<PublicPlan[]> {
  try {
    await ensureSeeded();
    const rows = await prisma.plan.findMany({ orderBy: { order: "asc" } });
    return rows.map(toPublic);
  } catch (err) {
    console.error("[plans] read failed:", err);
    return DEFAULT_PLANS;
  }
}

// Только активные — для витрин (лендинг, биллинг).
export async function getActivePlans(): Promise<PublicPlan[]> {
  return (await getPlans()).filter((p) => p.active);
}

// Обновление одного тарифа из админки (только редактируемые поля).
export async function savePlan(
  id: string,
  patch: Partial<Omit<PublicPlan, "id">>
): Promise<PublicPlan | null> {
  const data: Prisma.PlanUpdateInput = {};
  if (typeof patch.label === "string") data.label = patch.label.trim().slice(0, 80);
  if (typeof patch.priceRub === "number") data.priceRub = Math.max(0, Math.trunc(patch.priceRub));
  if (typeof patch.period === "string") data.period = patch.period.trim().slice(0, 80);
  if (Array.isArray(patch.features)) {
    data.features = patch.features.map((f) => String(f).trim().slice(0, 120)).filter(Boolean).slice(0, 8);
  }
  if (patch.limits) data.limits = normalizeLimits(patch.limits) as unknown as Prisma.InputJsonValue;
  if (typeof patch.order === "number") data.order = Math.trunc(patch.order);
  if (typeof patch.highlighted === "boolean") data.highlighted = patch.highlighted;
  if (typeof patch.active === "boolean") data.active = patch.active;

  const updated = await prisma.plan.update({ where: { id }, data }).catch(() => null);
  return updated ? toPublic(updated) : null;
}

// Форматирование цены: 4000 → "4 000 ₽", 0 → "0 ₽".
export function formatPrice(priceRub: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(priceRub)} ₽`;
}
