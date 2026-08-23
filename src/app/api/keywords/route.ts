import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fetchSuggestions } from "@/lib/youtube-scrape";
import { MAX_SUGGESTIONS } from "@/lib/keywords";

export const dynamic = "force-dynamic";

// GET /api/keywords?q=… — что люди дописывают к запросу в поиске YouTube.
//
// ⚠️ Квоту НЕ тратит и units YouTube тоже: подсказки берутся из автодополнения,
// которого в Data API нет вовсе. Поэтому крутить подбор можно сколько угодно.
//
// Расширяем в два уровня: по самому запросу и по трём верхним подсказкам — так из
// одной темы получается два десятка живых формулировок, а не десять.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ suggestions: [] });

  const base = await fetchSuggestions(q);
  const deeper = await Promise.all(
    base.slice(0, 3).map((phrase) => fetchSuggestions(phrase).catch(() => []))
  );

  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const phrase of [...base, ...deeper.flat()]) {
    const key = phrase.toLowerCase();
    if (seen.has(key) || key === q.toLowerCase()) continue;
    seen.add(key);
    suggestions.push(phrase);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return NextResponse.json({ suggestions });
}
