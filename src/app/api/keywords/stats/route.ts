import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { fetchSearchStats } from "@/lib/youtube-scrape";
import { MAX_STATS_QUERIES, median, type KeywordStats } from "@/lib/keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/keywords/stats — конкуренция и «живость» по выбранным фразам.
// Тело: { queries: string[] }.
//
// ⚠️ Отдельным шагом от подсказок, а не вместе с ними: подсказка стоит один
// лёгкий запрос, а оценка фразы — целая страница выдачи (полтора мегабайта).
// Поэтому человек сначала смотрит список, а оценивает только то, что выбрал.
// ⚠️ Квоту тарифа и units YouTube не тратит.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const body = await readJson(req);
  const raw = Array.isArray(body?.queries) ? body.queries : [];
  const queries = raw
    .filter((q: unknown): q is string => typeof q === "string")
    .map((q) => q.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, MAX_STATS_QUERIES);

  if (queries.length === 0) return NextResponse.json({ stats: [] });

  const stats = await Promise.all(
    queries.map(async (query): Promise<KeywordStats | null> => {
      const res = await fetchSearchStats(query).catch(() => null);
      if (!res) return null;
      return {
        query,
        totalResults: res.totalResults,
        medianViews: median(res.top.map((v) => v.views).filter((v) => v > 0)),
        top: res.top.slice(0, 3).map((v) => ({
          id: v.id,
          title: v.title,
          channelTitle: v.channelTitle,
          views: v.views,
        })),
      };
    })
  );

  // Не достали — молча пропускаем строку: разметка YouTube не документирована, и
  // «нет данных» тут штатное состояние, а не ошибка запроса.
  return NextResponse.json({ stats: stats.filter(Boolean) });
}
