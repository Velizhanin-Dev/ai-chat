import { NextResponse } from "next/server";
import { getSessionUser, publicUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/http";
import { syncPayment } from "@/lib/billing";

// Синхронизация платежа на возврате (SuccessURL). Спрашиваем GetState у ТБанк и
// применяем оплату, если прошла, — чтобы тариф отразился даже без дошедшего
// вебхука. Возвращаем статус + свежий снимок юзера (клиент обновит стор).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const orderId = new URL(req.url).searchParams.get("order") || "";
  if (!orderId) return apiError("Не указан платёж", 400);

  const status = await syncPayment(orderId, user.id);
  if (status === null) return apiError("Платёж не найден", 404);

  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  return NextResponse.json({ status, user: fresh ? publicUser(fresh) : null });
}
