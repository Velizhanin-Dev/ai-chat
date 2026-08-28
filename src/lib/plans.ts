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
  // Сколько проектов на Instagram можно завести. Считается ОТДЕЛЬНО от projects:
  // тариф может давать пять YouTube-проектов и один Instagram — это разные
  // продукты по трудозатратам. ⚠️ 0 = Instagram на тарифе не продаётся (кнопка
  // выбора площадки задизейблена), -1 = без лимита.
  instagram: number;
  // Сколько устройств (активных сессий) можно держать на аккаунте одновременно.
  // ⚠️ Здесь 0 = БЕЗ ограничения, а не «не применимо»: у тарифов, заведённых до
  // появления поля, его в JSON нет, и трактовка «0 = ноль устройств» заперла бы
  // вход всем разом. Без лимита можно задать и явным -1.
  devices: number;
  // Отчёт по каналу для клиента продюсера (PDF). ⚠️ Это не счётчик, а рубильник:
  // 1 = кнопка отчёта есть, 0 или отсутствие ключа = функции на тарифе нет.
  // Отчёт — инструмент агентства, а не автора-одиночки: продюсер показывает его
  // своему клиенту, поэтому и включается он только на «продюсерских» тарифах.
  reports: number;
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

// Что отдаёт GET /api/plans клиенту: витрина (активные) + собственный тариф юзера,
// если он архивный. Архивный тариф не продаётся, но обязан работать у тех, у кого
// он уже куплен, — поэтому его лимиты клиенту всё равно нужны.
export interface PlansView {
  plans: PublicPlan[];
  currentPlan: PublicPlan | null;
}

const EMPTY_LIMITS: PlanLimits = { requests: 0, projects: 0, instagram: 0, devices: 0, reports: 0 };

// Дефолты = текущие захардкоженные тарифы (start/blogger/studio). Используются для
// первичного посева таблицы (idempotent) — дальше правятся из админки.
export const DEFAULT_PLANS: PublicPlan[] = [
  {
    id: "start",
    label: "Пробный",
    priceRub: 0,
    period: "1 час · без карты",
    features: ["12 запросов на пробу", "Голос и методика Николая", "Без оплаты и привязки карты"],
    limits: { ...EMPTY_LIMITS, requests: 12, projects: 1, instagram: 1, devices: 1 },
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
    limits: { requests: -1, projects: 5, instagram: 2, devices: 3, reports: 0 },
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
    // Отчёт для клиента — на максимальном: им пользуются продюсеры и агентства.
    limits: { requests: -1, projects: -1, instagram: -1, devices: 10, reports: 1 },
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
  return {
    requests: num(o.requests),
    projects: num(o.projects),
    instagram: num(o.instagram),
    devices: num(o.devices),
    reports: num(o.reports),
  };
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

// id тарифа — slug (латиница/цифры/дефис/подчёркивание). Он попадает в User.plan
// и в платежи, поэтому после создания НЕ меняется (переименовать можно label).
export const PLAN_ID_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

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

// Только активные — для ВИТРИН (лендинг, биллинг): что сейчас можно купить.
// ⚠️ Для проверки прав/лимитов конкретного юзера это использовать НЕЛЬЗЯ — у него
// может быть архивный (неактивный) тариф, который обязан продолжать работать.
// Для этого есть getPlans()/getPlanById().
export async function getActivePlans(): Promise<PublicPlan[]> {
  return (await getPlans()).filter((p) => p.active);
}

// Тариф по id — ВКЛЮЧАЯ архивные (active=false). Именно так резолвятся лимиты
// действующей подписки: тариф сняли с витрины, но у купивших он работает.
export async function getPlanById(id: string): Promise<PublicPlan | null> {
  return (await getPlans()).find((p) => p.id === id) ?? null;
}

// Создание нового тарифа из админки. id задаётся руками (slug) и потом не меняется.
// Возвращает ошибку строкой, если id занят/кривой.
export async function createPlan(input: {
  id: string;
  label: string;
  priceRub?: number;
  period?: string;
  features?: string[];
  limits?: Partial<PlanLimits>;
  highlighted?: boolean;
  active?: boolean;
}): Promise<{ ok: true; plan: PublicPlan } | { ok: false; error: string }> {
  const id = String(input.id ?? "").trim().toLowerCase();
  if (!PLAN_ID_RE.test(id)) {
    return {
      ok: false,
      error: "id: латиница, цифры, дефис или подчёркивание, 2–31 символ (например blogger-2026)",
    };
  }
  const label = String(input.label ?? "").trim().slice(0, 80);
  if (!label) return { ok: false, error: "Укажите название тарифа" };

  try {
    await ensureSeeded();
    const exists = await prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (exists) return { ok: false, error: `Тариф с id «${id}» уже есть` };

    // Новый тариф встаёт в конец витрины.
    const last = await prisma.plan.aggregate({ _max: { order: true } });
    const order = (last._max.order ?? -1) + 1;

    const created = await prisma.plan.create({
      data: {
        id,
        label,
        priceRub: Math.max(0, Math.trunc(input.priceRub ?? 0)),
        period: String(input.period ?? "в месяц").trim().slice(0, 80),
        features: (input.features ?? [])
          .map((f) => String(f).trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 8),
        limits: normalizeLimits(input.limits) as unknown as Prisma.InputJsonValue,
        order,
        highlighted: Boolean(input.highlighted),
        active: input.active ?? true,
      },
    });
    return { ok: true, plan: toPublic(created) };
  } catch (err) {
    console.error("[plans] create failed:", err);
    return { ok: false, error: "Не удалось создать тариф" };
  }
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
