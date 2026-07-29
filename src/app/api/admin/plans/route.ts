import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { getPlans, savePlan, createPlan, type PublicPlan } from "@/lib/plans";

// Чтение/редактирование тарифов из админки. Только для админа; не-админу — 404.

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);
  return NextResponse.json({ plans: await getPlans() });
}

// Создание нового тарифа. Тарифы функционально одинаковы — отличаются только
// ценой/лимитами/витриной, поэтому заводятся из админки без изменений кода.
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return apiError("Некорректный запрос", 400);

  const res = await createPlan({
    id: String(body.id ?? ""),
    label: String(body.label ?? ""),
    priceRub: typeof body.priceRub === "number" ? body.priceRub : 0,
    period: typeof body.period === "string" ? body.period : undefined,
    features: Array.isArray(body.features) ? (body.features as string[]) : [],
    limits:
      body.limits && typeof body.limits === "object"
        ? (body.limits as { requests?: number; projects?: number })
        : undefined,
    highlighted: Boolean(body.highlighted),
    active: body.active === undefined ? true : Boolean(body.active),
  });
  if (!res.ok) return apiError(res.error, 400);
  return NextResponse.json({ plan: res.plan });
}

export async function PATCH(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const body = (await readJson(req)) as { id?: string; patch?: Partial<PublicPlan> } | null;
  const id = body?.id;
  if (!id) return apiError("Не указан тариф", 400);

  const updated = await savePlan(id, body?.patch ?? {});
  if (!updated) return apiError("Тариф не найден", 404);
  return NextResponse.json({ plan: updated });
}
