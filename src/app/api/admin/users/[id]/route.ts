import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { getPlans } from "@/lib/plans";
import { rowToUtm, utmLabel } from "@/lib/utm";
import type { AdminUserRow } from "../route";

// Управление конкретным пользователем из админки: смена роли / тарифа / срока
// подписки (PATCH) и удаление (DELETE). Только для админа; не-админу — 404.
// Себя нельзя разжаловать из админов и нельзя удалить (защита от само-локаута).

const ROLES = ["user", "admin"];

async function buildRow(id: string): Promise<AdminUserRow | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    include: { oauthAccounts: { select: { provider: true } } },
  });
  if (!u) return null;
  const authMethods = [
    ...(u.passwordHash ? ["email"] : []),
    ...u.oauthAccounts.map((a) => a.provider),
  ];
  const [plans, projectCount] = await Promise.all([
    getPlans(),
    prisma.conversation.count({ where: { userId: u.id } }),
  ]);
  const plan = plans.find((p) => p.id === u.plan);
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
    requestsLimit: plan ? plan.limits.requests : null,
    projectCount,
    lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
    source: utmLabel(rowToUtm(u)),
    sourceReferrer: u.utmReferrer,
    sourceLanding: u.utmLanding,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return apiError("Пользователь не найден", 404);

  const body = await readJson(req);
  if (!body) return apiError("Некорректный запрос");

  const data: {
    role?: string;
    plan?: string;
    planExpiresAt?: Date | null;
    requestsUsed?: number;
  } = {};

  // Роль
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!ROLES.includes(role)) return apiError("Недопустимая роль");
    if (target.id === admin.id && role !== "admin") {
      return apiError("Нельзя снять админ-роль с самого себя");
    }
    data.role = role;
  }

  // Тариф — валидируем против существующих тарифов в БД. При СМЕНЕ тарифа
  // обнуляем счётчик израсходованных запросов (новый период → свежая квота).
  if (body.plan !== undefined) {
    const plan = String(body.plan);
    const plans = await getPlans();
    if (!plans.some((p) => p.id === plan)) return apiError("Недопустимый тариф");
    data.plan = plan;
    if (plan !== target.plan) data.requestsUsed = 0;
  }

  // Явный сброс квоты запросов (кнопка «Сбросить запросы» в админке).
  if (body.resetRequests === true) data.requestsUsed = 0;

  // Срок подписки: ISO-строка или null (сбросить).
  if (body.planExpiresAt !== undefined) {
    if (body.planExpiresAt === null) {
      data.planExpiresAt = null;
    } else {
      const d = new Date(String(body.planExpiresAt));
      if (Number.isNaN(d.getTime())) return apiError("Некорректная дата окончания");
      data.planExpiresAt = d;
    }
  }

  if (Object.keys(data).length === 0) return apiError("Нечего обновлять");

  await prisma.user.update({ where: { id: params.id }, data });
  const row = await buildRow(params.id);
  return NextResponse.json({ user: row });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  if (params.id === admin.id) {
    return apiError("Нельзя удалить собственный аккаунт");
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return apiError("Пользователь не найден", 404);

  // payments / oauthAccounts / tokens удалятся каскадом (onDelete: Cascade).
  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
