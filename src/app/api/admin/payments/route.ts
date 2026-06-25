import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getPlans } from "@/lib/plans";

// История платежей пользователя для админки (карточка юзера → «История платежей»).
// Только для админа; не-админу — 404.

export interface AdminPaymentRow {
  id: string;
  planId: string;
  planLabel: string;
  amount: number; // копейки
  status: string;
  tbankPaymentId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const userId = new URL(req.url).searchParams.get("userId") || "";
  if (!userId) return apiError("Не указан пользователь", 400);

  const [rows, plans] = await Promise.all([
    prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    getPlans(),
  ]);
  const labelOf = (id: string) => plans.find((p) => p.id === id)?.label ?? id;

  const payments: AdminPaymentRow[] = rows.map((p) => ({
    id: p.id,
    planId: p.planId,
    planLabel: labelOf(p.planId),
    amount: p.amount,
    status: p.status,
    tbankPaymentId: p.tbankPaymentId,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  }));

  return NextResponse.json({ payments });
}
