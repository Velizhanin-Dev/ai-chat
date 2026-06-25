import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { getPlans, savePlan, type PublicPlan } from "@/lib/plans";

// Чтение/редактирование тарифов из админки. Только для админа; не-админу — 404.

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);
  return NextResponse.json({ plans: await getPlans() });
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
