import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { normalizeSupportRole, type SupportThreadRow } from "@/lib/support";

// Список переписок с поддержкой для админки: по строке на пользователя, свежие
// сверху, с хвостом диалога и числом непрочитанных вопросов. Только админ, иначе 404.
//
// Считаем в два прохода вместо одного «умного» join'а: сперва непрочитанные
// (groupBy), потом последние сообщения тредов. Join сообщений с сообщениями
// размножал бы строки и завышал счётчик непрочитанных.

const PAGE_SIZE = 30;

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = (url.searchParams.get("q") || "").trim();
  // "unread" — только треды с неотвеченными вопросами.
  const onlyUnread = url.searchParams.get("filter") === "unread";

  // ── Непрочитанные вопросы по юзерам ──
  const unreadGroups = await prisma.supportMessage.groupBy({
    by: ["userId"],
    where: { role: "user", readAt: null },
    _count: { _all: true },
  });
  const unreadBy = new Map(unreadGroups.map((g) => [g.userId, g._count._all]));

  // ── Отбор юзеров под фильтры (поиск по имени/почте + «только непрочитанные») ──
  // null = ограничения нет (все, у кого вообще есть переписка).
  let userFilter: string[] | null = null;
  if (q) {
    const found = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    userFilter = found.map((u) => u.id);
  }
  if (onlyUnread) {
    const ids = Array.from(unreadBy.keys());
    userFilter = userFilter ? userFilter.filter((id) => unreadBy.has(id)) : ids;
  }
  // Фильтр отсёк всех — дальше идти незачем.
  if (userFilter && userFilter.length === 0) {
    return NextResponse.json({ threads: [], total: 0, page, pageSize: PAGE_SIZE });
  }

  const where = userFilter ? { userId: { in: userFilter } } : {};

  // ── Треды: последнее сообщение каждого юзера, свежие сверху ──
  const [groups, allGroups] = await Promise.all([
    prisma.supportMessage.groupBy({
      by: ["userId"],
      where,
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    // Всего тредов под фильтром (для пагинации).
    prisma.supportMessage.groupBy({ by: ["userId"], where }),
  ]);

  if (groups.length === 0) {
    return NextResponse.json({
      threads: [],
      total: allGroups.length,
      page,
      pageSize: PAGE_SIZE,
    });
  }

  // Сами последние сообщения (пара userId+createdAt однозначна на практике;
  // при совпадении времени берём любое — тексты в списке всё равно усечены).
  const [lastMessages, users] = await Promise.all([
    prisma.supportMessage.findMany({
      where: {
        OR: groups.map((g) => ({
          userId: g.userId,
          createdAt: g._max.createdAt as Date,
        })),
      },
      select: { userId: true, role: true, content: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { id: { in: groups.map((g) => g.userId) } },
      select: { id: true, name: true, email: true, plan: true },
    }),
  ]);

  const lastBy = new Map(lastMessages.map((m) => [m.userId, m]));
  const userBy = new Map(users.map((u) => [u.id, u]));

  const threads: SupportThreadRow[] = groups.flatMap((g) => {
    const last = lastBy.get(g.userId);
    const u = userBy.get(g.userId);
    if (!last || !u) return []; // юзера удалили между запросами — строку пропускаем
    return [
      {
        userId: g.userId,
        name: u.name,
        email: u.email,
        plan: u.plan,
        lastMessage: last.content,
        lastRole: normalizeSupportRole(last.role),
        lastAt: last.createdAt.toISOString(),
        unread: unreadBy.get(g.userId) ?? 0,
      },
    ];
  });

  return NextResponse.json({
    threads,
    total: allGroups.length,
    page,
    pageSize: PAGE_SIZE,
  });
}
