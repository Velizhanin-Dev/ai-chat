import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { sanitizeQueries } from "@/lib/competitors";
import {
  getCompetitorContext,
  runCompetitorSearch,
  normalizeOrder,
  normalizePeriod,
} from "@/lib/competitors-server";

export const dynamic = "force-dynamic";

// Раздел «Конкуренты в нише» — пока ТОЛЬКО для админов (getAdminUser → 404, как в
// /admin: не светим существование раздела). Поиск дорогой по квоте YouTube, так что
// открывать его всем рано.
//
// GET  ?projectId= — контекст: подсказки запросов, состояние пула ключей.
// POST { projectId, queries, periodDays, order, force } — сам поиск.

async function guard(projectId: string) {
  const admin = await getAdminUser();
  if (!admin) return null;
  return assertOwnedProject(admin.id, projectId);
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await guard(projectId);
  if (!owned) return apiError("Не найдено", 404);

  return NextResponse.json(await getCompetitorContext(owned));
}

export async function POST(req: Request) {
  const body = (await readJson(req)) ?? {};
  const owned = await guard(String(body.projectId ?? ""));
  if (!owned) return apiError("Не найдено", 404);

  const queries = sanitizeQueries(body.queries);
  if (queries.length === 0) return apiError("Добавьте хотя бы один запрос", 400);

  const out = await runCompetitorSearch(owned, {
    queries,
    periodDays: normalizePeriod(body.periodDays),
    order: normalizeOrder(body.order),
    force: Boolean(body.force),
  });

  if (out.status === "no_keys") {
    return apiError(
      "Ключи YouTube API не настроены — задайте YOUTUBE_API_KEYS на сервере",
      503,
      "YT_NO_KEYS"
    );
  }
  if (out.status === "quota") {
    return apiError(
      "Суточная квота YouTube исчерпана по всем ключам. Сбросится в полночь по тихоокеанскому времени",
      429,
      "YT_QUOTA"
    );
  }
  if (out.status === "error") return apiError(out.message, 502);

  return NextResponse.json({ result: out.result, cached: out.cached });
}
