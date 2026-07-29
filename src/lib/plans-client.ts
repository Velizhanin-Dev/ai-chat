import type { PublicPlan, PlansView } from "./plans";

// Клиентский кэш тарифов (GET /api/plans). Несколько потребителей — кружок квоты
// в шапке, карточки тарифов, хук доступа к чату — делят один запрос, а не дёргают
// сеть каждый по отдельности. Кэш живёт на время жизни вкладки; после оплаты
// приложение всё равно перезагружается (редирект ТБанк → /payment).
//
// Ответ несёт витрину (активные тарифы) И собственный тариф юзера, если тот снят
// с витрины (архивный). Всё, что считает ЛИМИТЫ юзера, обязано искать тариф через
// findUserPlan — иначе у людей на архивном тарифе «пропадает» подписка.
let cache: Promise<PlansView> | null = null;

export function fetchPlansView(): Promise<PlansView> {
  if (!cache) {
    cache = fetch("/api/plans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("plans fetch failed"))))
      .then((d: Partial<PlansView>) => ({
        plans: Array.isArray(d.plans) ? d.plans : [],
        currentPlan: d.currentPlan ?? null,
      }))
      .catch((e) => {
        cache = null; // не кэшируем ошибку — дать шанс повторить
        throw e;
      });
  }
  return cache;
}

// Только витрина (что можно купить) — для мест, где свой тариф не важен.
export function fetchActivePlans(): Promise<PublicPlan[]> {
  return fetchPlansView().then((v) => v.plans);
}

// Тариф юзера: сперва среди активных, затем — архивный из currentPlan.
// null = тарифа нет вовсе (битые данные / гость).
export function findUserPlan(
  view: PlansView,
  planId: string | undefined | null
): PublicPlan | null {
  if (!planId) return null;
  const active = view.plans.find((p) => p.id === planId);
  if (active) return active;
  return view.currentPlan?.id === planId ? view.currentPlan : null;
}
