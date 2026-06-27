import type { PublicPlan } from "./plans";

// Клиентский кэш активных тарифов (GET /api/plans). Несколько потребителей —
// кружок квоты в шапке, карточки тарифов, хук доступа к чату — делят один запрос,
// а не дёргают сеть каждый по отдельности. Кэш живёт на время жизни вкладки;
// после оплаты приложение всё равно перезагружается (редирект ТБанк → /chat).
let cache: Promise<PublicPlan[]> | null = null;

export function fetchActivePlans(): Promise<PublicPlan[]> {
  if (!cache) {
    cache = fetch("/api/plans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("plans fetch failed"))))
      .then((d: { plans: PublicPlan[] }) => d.plans)
      .catch((e) => {
        cache = null; // не кэшируем ошибку — дать шанс повторить
        throw e;
      });
  }
  return cache;
}
