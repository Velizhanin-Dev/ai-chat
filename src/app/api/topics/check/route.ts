import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { checkTopics, MAX_TOPICS } from "@/lib/topic-evidence";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/topics/check — что по этим темам уже есть в выдаче YouTube.
// Тело: { topics: string[] }.
//
// ⚠️ Ни квоты тарифа, ни units YouTube: выдача читается мимо Data API. Поэтому
// проверять можно каждую тему, а не выборочно — в этом весь смысл.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const body = await readJson(req);
  const raw = Array.isArray(body?.topics) ? body.topics : [];
  const topics = raw
    .filter((t: unknown): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, MAX_TOPICS);

  if (topics.length === 0) return NextResponse.json({ evidence: [], failed: 0 });
  const res = await checkTopics(topics);
  return NextResponse.json(res);
}
