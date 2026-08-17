import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { createPayment } from "@/lib/billing";
import { sanitizeUtm } from "@/lib/utm";

// Создать платёж за тариф и вернуть ссылку на платёжную страницу ТБанк.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const planId = typeof body?.planId === "string" ? body.planId : "";
  if (!planId) return apiError("Не указан тариф", 400);

  const res = await createPayment(user, planId, sanitizeUtm(body?.utm));
  if (!res.ok) return apiError(res.error || "Не удалось создать платёж", 400);
  return NextResponse.json({ url: res.url });
}
