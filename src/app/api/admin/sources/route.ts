import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { rowToUtm, hasUtm, type Utm } from "@/lib/utm";

// Отчёт «Источники» для админки: сколько людей пришло по каждой utm-метке и
// сколько из них купило. Метка регистрации хранится у User (первое касание),
// метка покупки — у Payment (см. src/lib/utm.ts).
//
// ⚠️ Строка отчёта = метка, а не человек: регистрации считаются по User, оплаты —
// по Payment. Поэтому конверсия в строке — «оплат на регистрацию по этой метке»,
// а не воронка одного и того же человека: пришёл он по одной ссылке, а заплатил
// после другой — и это ровно то, что мы хотим видеть раздельно.

export interface SourceRow {
  key: string; // "tg|article|ad" — только для React-ключа
  source: string;
  medium: string;
  campaign: string;
  signups: number;
  payments: number; // подтверждённые оплаты
  revenue: number; // рубли
}

export interface SourcesView {
  rows: SourceRow[];
  totals: { signups: number; payments: number; revenue: number };
  days: number; // 0 = всё время
  // Оплаты, у которых своей метки не было и источник взят из регистрации
  // плательщика: без этой цифры непонятно, насколько отчёту вообще верить.
  inheritedPayments: number;
}

const NONE = "—"; // без меток: прямые заходы, закладки, органика

function keyOf(u: Utm): string {
  return [u.source || NONE, u.medium || NONE, u.campaign || NONE].join("|");
}

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const days = Math.max(0, Number(new URL(req.url).searchParams.get("days")) || 0);
  const since = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  const [signupGroups, payments] = await Promise.all([
    prisma.user.groupBy({
      by: ["utmSource", "utmMedium", "utmCampaign"],
      where: since ? { createdAt: { gte: since } } : {},
      _count: { _all: true },
    }),
    // Оплаченных платежей мало даже за всё время, поэтому берём строками и
    // группируем в памяти: нужен фолбэк на метку плательщика, а он в groupBy
    // не выражается.
    prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        ...(since ? { paidAt: { gte: since } } : {}),
      },
      select: {
        amount: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmContent: true,
        utmTerm: true,
        user: {
          select: {
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmContent: true,
            utmTerm: true,
          },
        },
      },
    }),
  ]);

  const rows = new Map<string, SourceRow>();
  const rowFor = (u: Utm): SourceRow => {
    const key = keyOf(u);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        source: u.source || NONE,
        medium: u.medium || NONE,
        campaign: u.campaign || NONE,
        signups: 0,
        payments: 0,
        revenue: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const g of signupGroups) {
    rowFor(rowToUtm(g)).signups += g._count._all;
  }

  let inheritedPayments = 0;
  for (const p of payments) {
    const own = rowToUtm(p);
    // Платёж без своей метки (человек пришёл по закладке) — приписываем источнику,
    // с которого он когда-то зарегистрировался: иначе канал, который реально привёл
    // платящего, в отчёте выглядит бесплатным трафиком.
    const utm = hasUtm(own) ? own : rowToUtm(p.user ?? {});
    if (!hasUtm(own) && hasUtm(utm)) inheritedPayments += 1;
    const row = rowFor(utm);
    row.payments += 1;
    row.revenue += p.amount / 100;
  }

  // ⚠️ forEach, а НЕ [...map.values()]: текущий target проекта не разрешает
  // итерацию Map (те же грабли, что с итерацией Set в content-plan.ts).
  const list: SourceRow[] = [];
  rows.forEach((r) => list.push(r));
  list.sort((a, b) => b.revenue - a.revenue || b.signups - a.signups);

  const view: SourcesView = {
    rows: list,
    totals: {
      signups: list.reduce((s, r) => s + r.signups, 0),
      payments: list.reduce((s, r) => s + r.payments, 0),
      revenue: list.reduce((s, r) => s + r.revenue, 0),
    },
    days,
    inheritedPayments,
  };
  return NextResponse.json(view);
}
