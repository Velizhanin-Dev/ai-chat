import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getPlans } from "@/lib/plans";
import { rowToUtm, hasUtm, utmLabel } from "@/lib/utm";

// Подпись источника платежа. Своя метка приоритетнее; если её нет (пришёл
// напрямую и оплатил) — показываем, откуда он зарегистрировался, с пометкой.
function sourceOf(
  payment: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null },
  user?: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } | null
): { source: string; sourceInherited: boolean } {
  const own = rowToUtm(payment);
  if (hasUtm(own)) return { source: utmLabel(own), sourceInherited: false };
  const fromUser = rowToUtm(user ?? {});
  if (hasUtm(fromUser)) return { source: utmLabel(fromUser), sourceInherited: true };
  return { source: "—", sourceInherited: false };
}

// История платежей для админки. Два режима:
//  • ?userId= — платежи одного юзера (карточка юзера → «История платежей»);
//  • без userId — глобальный список всех платежей (страница /admin/payments) с
//    пагинацией, поиском по юзеру и фильтром по статусу.
// Только для админа; не-админу — 404.

export interface AdminPaymentRow {
  id: string;
  planId: string;
  planLabel: string;
  amount: number; // копейки
  status: string;
  provider: string; // "tbank" | "cloudpayments"
  tbankPaymentId: string | null;
  // Откуда пришла покупка: «tg / article / ad» (метка платежа, фолбэк — метка
  // регистрации плательщика) и пометка, что метка унаследована от юзера.
  source: string;
  sourceInherited: boolean;
  createdAt: string;
  paidAt: string | null;
}

// Строка глобального списка — плюс данные плательщика.
export interface AdminPaymentListRow extends AdminPaymentRow {
  userId: string;
  userName: string;
  userEmail: string;
}

const PAGE_SIZE = 30;

// Группировка raw-статусов ТБанк под фильтр (совпадает с paymentBadgeMeta).
const STATUS_GROUPS: Record<string, string[]> = {
  paid: ["CONFIRMED"],
  failed: ["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "AUTH_FAIL"],
  refund: ["REFUNDED", "PARTIAL_REFUNDED"],
};
// «Ожидают» = всё, что не попало в терминальные группы (NEW, AUTHORIZED, …).
const TERMINAL_STATUSES = [
  ...STATUS_GROUPS.paid,
  ...STATUS_GROUPS.failed,
  ...STATUS_GROUPS.refund,
];

function statusWhere(status: string): Prisma.PaymentWhereInput {
  if (status === "pending") return { status: { notIn: TERMINAL_STATUSES } };
  if (STATUS_GROUPS[status]) return { status: { in: STATUS_GROUPS[status] } };
  return {};
}

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || "";
  const plans = await getPlans();
  const labelOf = (id: string) => plans.find((p) => p.id === id)?.label ?? id;

  // ── Режим одного юзера (для карточки в списке пользователей) ──────────────
  if (userId) {
    const [rows, owner] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { utmSource: true, utmMedium: true, utmCampaign: true },
      }),
    ]);
    const payments: AdminPaymentRow[] = rows.map((p) => ({
      id: p.id,
      planId: p.planId,
      planLabel: labelOf(p.planId),
      amount: p.amount,
      status: p.status,
      provider: p.provider,
      tbankPaymentId: p.tbankPaymentId,
      ...sourceOf(p, owner),
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    }));
    return NextResponse.json({ payments });
  }

  // ── Глобальный список (страница /admin/payments) ─────────────────────────
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = (url.searchParams.get("q") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();

  const where: Prisma.PaymentWhereInput = {
    ...(q
      ? {
          user: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
    ...statusWhere(status),
  };

  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
          },
        },
      },
    }),
  ]);

  const payments: AdminPaymentListRow[] = rows.map((p) => ({
    id: p.id,
    planId: p.planId,
    planLabel: labelOf(p.planId),
    amount: p.amount,
    status: p.status,
    provider: p.provider,
    tbankPaymentId: p.tbankPaymentId,
    ...sourceOf(p, p.user),
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    userId: p.userId,
    userName: p.user?.name ?? "—",
    userEmail: p.user?.email ?? "—",
  }));

  return NextResponse.json({ payments, total, page, pageSize: PAGE_SIZE });
}
