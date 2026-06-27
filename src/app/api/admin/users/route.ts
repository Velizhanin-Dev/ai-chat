import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getPlans } from "@/lib/plans";

// Список зарегистрированных для админки: пагинация + поиск по имени/почте. Бриф
// теперь у проектов (см. /api/admin/users/[id]/projects), здесь его нет — в строке
// только сводка (число проектов + квота запросов). Только для админа; иначе 404.

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  role: string;
  emailVerified: boolean;
  // Способ входа: "email" (есть пароль) и/или подключённые соцсети ("vk"/"yandex").
  authMethods: string[];
  // Подписка активна до (ISO) или null (пробный — +1ч, платный — +30д).
  planExpiresAt: string | null;
  // Квота запросов: израсходовано + лимит тарифа (-1 = без лимита, null = тариф не найден).
  requestsUsed: number;
  requestsLimit: number | null;
  // Сколько проектов (диалогов) у пользователя.
  projectCount: number;
  // Последний визит (ISO) или null, если ни разу после введения поля.
  lastSeenAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = (url.searchParams.get("q") || "").trim();

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, rows, plans] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { oauthAccounts: { select: { provider: true } } },
    }),
    getPlans(),
  ]);

  // Число проектов на каждого юзера страницы — одним groupBy.
  const counts = await prisma.conversation.groupBy({
    by: ["userId"],
    where: { userId: { in: rows.map((u) => u.id) } },
    _count: { _all: true },
  });
  const countByUser = new Map(counts.map((c) => [c.userId, c._count._all]));
  const requestsLimitByPlan = new Map(plans.map((p) => [p.id, p.limits.requests]));

  const users: AdminUserRow[] = rows.map((u) => {
    const authMethods = [
      ...(u.passwordHash ? ["email"] : []),
      ...u.oauthAccounts.map((a) => a.provider),
    ];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      role: u.role,
      emailVerified: Boolean(u.emailVerified),
      authMethods,
      planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
      requestsUsed: u.requestsUsed,
      requestsLimit: requestsLimitByPlan.has(u.plan) ? requestsLimitByPlan.get(u.plan)! : null,
      projectCount: countByUser.get(u.id) ?? 0,
      lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ users, total, page, pageSize: PAGE_SIZE });
}
