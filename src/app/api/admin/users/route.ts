import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { sanitizeBrief, isBriefComplete, type Brief, type DiscType } from "@/lib/brief";

// Список зарегистрированных для админки: пагинация + поиск по имени/почте. Бриф
// отдаём сразу (нормализованным) — чтобы Drawer с деталями не делал второй запрос.
// Только для админа; не-админу — 404 (как и вся зона /admin).

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  role: string;
  emailVerified: boolean;
  briefCompleted: boolean;
  disc: DiscType | null;
  brief: Brief | null;
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

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const users: AdminUserRow[] = rows.map((u) => {
    const brief: Brief | null = u.brief ? sanitizeBrief(u.brief) : null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      role: u.role,
      emailVerified: Boolean(u.emailVerified),
      briefCompleted: Boolean(u.briefCompletedAt) && isBriefComplete(brief),
      disc: brief?.disc ?? null,
      brief,
      createdAt: u.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ users, total, page, pageSize: PAGE_SIZE });
}
