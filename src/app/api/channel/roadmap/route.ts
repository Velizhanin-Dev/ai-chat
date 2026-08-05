import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getRoadmap, claimRoadmapStep, type RoadmapResult } from "@/lib/roadmap-server";

// Дорожная карта канала (docs/channel-roadmap.md). Пер-проектная — все вызовы
// несут ?projectId= и сверяют владение внутри roadmap-server. Квоту не тратит.

export const dynamic = "force-dynamic";

function toResponse(res: RoadmapResult): NextResponse {
  if (res.status === "not_found") return apiError("Проект не найден", 404);
  if (res.status === "not_connected") {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({ connected: true, roadmap: res.view });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const refresh = url.searchParams.get("refresh") === "1";
  const res = await getRoadmap(projectId, user.id, { refresh });
  return toResponse(res);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const body = await readJson(req);
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "claim") {
    const key = typeof body?.key === "string" ? body.key : "";
    if (!key) return apiError("Не указан шаг");
    return toResponse(await claimRoadmapStep(projectId, user.id, key));
  }
  if (action === "refresh") {
    return toResponse(await getRoadmap(projectId, user.id, { refresh: true }));
  }
  return apiError("Неизвестное действие");
}
