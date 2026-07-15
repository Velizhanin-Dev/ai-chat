import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { createCloudPayment } from "@/lib/billing";

// Создать платёж CloudPayments (зарубежная карта) за тариф и вернуть параметры для
// клиентского виджета. Сам виджет открывается на клиенте; подтверждение — вебхук.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const planId = typeof body?.planId === "string" ? body.planId : "";
  if (!planId) return apiError("Не указан тариф", 400);

  const res = await createCloudPayment(user, planId);
  if (!res.ok) return apiError(res.error || "Не удалось создать платёж", 400);
  return NextResponse.json({ params: res.params });
}
