import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

// ── Телеметрия вызовов модели → CRM-дашборд админки ────────────────────────
// recordStat снимает то, что раньше уходило только в логи (провайдер, модель,
// токены, стоимость), и пишет в таблицу Stat. Fire-and-forget: не ждём и не
// роняем запрос при ошибке (на ответ пользователю это не влияет).
// getDashboardData агрегирует Stat (+ Conversation/User) для графиков.

export type StatKind = "chat" | "title" | "router";

export interface StatInput {
  kind: StatKind;
  provider: string;
  model: string;
  userId?: string | null;
  conversationId?: string | null;
  routeCategory?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  latencyMs?: number | null;
}

export function recordStat(input: StatInput): void {
  prisma.stat
    .create({
      data: {
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        userId: input.userId ?? null,
        conversationId: input.conversationId ?? null,
        routeCategory: input.routeCategory ?? null,
        inputTokens: Math.round(input.inputTokens ?? 0),
        outputTokens: Math.round(input.outputTokens ?? 0),
        cachedTokens: Math.round(input.cachedTokens ?? 0),
        cacheWriteTokens: Math.round(input.cacheWriteTokens ?? 0),
        costUsd: input.costUsd ?? 0,
        latencyMs: input.latencyMs ?? null,
      },
    })
    .catch((err) => console.error("[stats] record failed:", err));
}

// ── Дашборд ─────────────────────────────────────────────────────────────────

export interface TopUser {
  userId: string;
  name: string;
  email: string;
  requests: number;
  cost: number;
  tokens: number;
}

export interface DashboardData {
  rangeDays: number;
  totals: {
    costUsd: number;
    requests: number; // сообщения ассистента (kind=chat)
    chats: number; // создано диалогов за период
    tokens: number; // вход+выход+кэш по всем вызовам
    activeUsers: number; // уникальные юзеры с запросами за период
    newUsers: number; // зарегистрировались за период
  };
  series: { day: string; cost: number; tokens: number; requests: number }[];
  providers: { provider: string; cost: number; requests: number }[];
  categories: { category: string; requests: number }[];
  topByRequests: TopUser[];
  topBySpend: TopUser[];
}

// YYYY-MM-DD в UTC (ключ для сопоставления дней при заполнении пропусков).
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDashboardData(rangeDays: number): Promise<DashboardData> {
  const days = Math.max(1, Math.min(365, Math.round(rangeDays) || 30));
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    agg,
    requests,
    chats,
    newUsers,
    activeRows,
    seriesRows,
    providerRows,
    categoryRows,
    topReqRows,
    topSpendRows,
  ] = await Promise.all([
    prisma.stat.aggregate({
      where: { createdAt: { gte: from } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true, cachedTokens: true },
    }),
    prisma.stat.count({ where: { createdAt: { gte: from }, kind: "chat" } }),
    prisma.conversation.count({ where: { createdAt: { gte: from } } }),
    prisma.user.count({ where: { createdAt: { gte: from } } }),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "userId")::int AS n FROM "Stat"
      WHERE "createdAt" >= ${from} AND "kind" = 'chat' AND "userId" IS NOT NULL
    `),
    prisma.$queryRaw<Array<{ day: Date; cost: number; tokens: number; requests: number }>>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day,
             COALESCE(SUM("costUsd"), 0)::float8 AS cost,
             COALESCE(SUM("inputTokens" + "outputTokens" + "cachedTokens"), 0)::float8 AS tokens,
             COUNT(*) FILTER (WHERE "kind" = 'chat')::int AS requests
      FROM "Stat"
      WHERE "createdAt" >= ${from}
      GROUP BY day
      ORDER BY day ASC
    `),
    prisma.$queryRaw<Array<{ provider: string; cost: number; requests: number }>>(Prisma.sql`
      SELECT "provider",
             COALESCE(SUM("costUsd"), 0)::float8 AS cost,
             COUNT(*) FILTER (WHERE "kind" = 'chat')::int AS requests
      FROM "Stat"
      WHERE "createdAt" >= ${from}
      GROUP BY "provider"
      ORDER BY cost DESC
    `),
    prisma.$queryRaw<Array<{ category: string; requests: number }>>(Prisma.sql`
      SELECT COALESCE("routeCategory", 'неизвестно') AS category,
             COUNT(*)::int AS requests
      FROM "Stat"
      WHERE "createdAt" >= ${from} AND "kind" = 'chat'
      GROUP BY category
      ORDER BY requests DESC
    `),
    prisma.$queryRaw<Array<TopUser>>(Prisma.sql`
      SELECT s."userId" AS "userId", u."name" AS name, u."email" AS email,
             COUNT(*) FILTER (WHERE s."kind" = 'chat')::int AS requests,
             COALESCE(SUM(s."costUsd"), 0)::float8 AS cost,
             COALESCE(SUM(s."inputTokens" + s."outputTokens" + s."cachedTokens"), 0)::float8 AS tokens
      FROM "Stat" s JOIN "User" u ON u.id = s."userId"
      WHERE s."createdAt" >= ${from} AND s."userId" IS NOT NULL
      GROUP BY s."userId", u."name", u."email"
      ORDER BY requests DESC
      LIMIT 8
    `),
    prisma.$queryRaw<Array<TopUser>>(Prisma.sql`
      SELECT s."userId" AS "userId", u."name" AS name, u."email" AS email,
             COUNT(*) FILTER (WHERE s."kind" = 'chat')::int AS requests,
             COALESCE(SUM(s."costUsd"), 0)::float8 AS cost,
             COALESCE(SUM(s."inputTokens" + s."outputTokens" + s."cachedTokens"), 0)::float8 AS tokens
      FROM "Stat" s JOIN "User" u ON u.id = s."userId"
      WHERE s."createdAt" >= ${from} AND s."userId" IS NOT NULL
      GROUP BY s."userId", u."name", u."email"
      ORDER BY cost DESC
      LIMIT 8
    `),
  ]);

  // Заполняем пропуски в днях нулями — чтобы ось времени была ровной.
  const byDay = new Map(seriesRows.map((r) => [dayKey(new Date(r.day)), r]));
  const series: DashboardData["series"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    const row = byDay.get(key);
    series.push({
      day: key,
      cost: row ? Number(row.cost) : 0,
      tokens: row ? Number(row.tokens) : 0,
      requests: row ? Number(row.requests) : 0,
    });
  }

  const sum = agg._sum;
  return {
    rangeDays: days,
    totals: {
      costUsd: sum.costUsd ?? 0,
      requests,
      chats,
      tokens: (sum.inputTokens ?? 0) + (sum.outputTokens ?? 0) + (sum.cachedTokens ?? 0),
      activeUsers: activeRows[0]?.n ?? 0,
      newUsers,
    },
    series,
    providers: providerRows.map((p) => ({
      provider: p.provider,
      cost: Number(p.cost),
      requests: Number(p.requests),
    })),
    categories: categoryRows.map((c) => ({
      category: c.category,
      requests: Number(c.requests),
    })),
    topByRequests: topReqRows.map(normalizeTop),
    topBySpend: topSpendRows.map(normalizeTop),
  };
}

function normalizeTop(r: TopUser): TopUser {
  return {
    userId: r.userId,
    name: r.name,
    email: r.email,
    requests: Number(r.requests),
    cost: Number(r.cost),
    tokens: Number(r.tokens),
  };
}
