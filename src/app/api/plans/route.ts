import { NextResponse } from "next/server";
import { getPlans, type PlansView } from "@/lib/plans";
import { getSessionUser } from "@/lib/auth";

// Тарифы для клиентских витрин (биллинг, кружок квоты, гейт чата).
// Лендинг читает активные тарифы серверно (см. app/page.tsx).
//
// Отдаём ДВЕ вещи:
//   plans       — только активные: что сейчас можно купить (витрина);
//   currentPlan — тариф текущего юзера, ЕСЛИ он снят с витрины (архивный).
// Второе критично: тариф архивируют, но у купивших подписка обязана работать —
// клиенту нужны его лимиты (запросы/проекты), иначе кружок квоты и гейт чата
// «теряют» тариф. Сервер лимиты и так резолвит по всем тарифам (getPlanById).
export const dynamic = "force-dynamic";

export async function GET() {
  const [all, user] = await Promise.all([getPlans(), getSessionUser()]);
  const plans = all.filter((p) => p.active);

  const own = user ? all.find((p) => p.id === user.plan) ?? null : null;
  const currentPlan = own && !own.active ? own : null;

  const view: PlansView = { plans, currentPlan };
  return NextResponse.json(view);
}
