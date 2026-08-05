import type { RoadmapView } from "./roadmap";

// ── Клиентские обёртки над /api/channel/roadmap ─────────────────────────────
// connected:false → канал к проекту не подключён (UI зовёт подключить).

export type RoadmapPayload =
  | { connected: false }
  | { connected: true; roadmap: RoadmapView };

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

export async function apiRoadmap(
  projectId: string,
  refresh = false
): Promise<Result<RoadmapPayload>> {
  try {
    const res = await fetch(
      `/api/channel/roadmap?${q(projectId)}${refresh ? "&refresh=1" : ""}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { ok: false, error: "Не удалось загрузить дорожную карту" };
    return { ok: true, data: (await res.json()) as RoadmapPayload };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiRoadmapClaim(
  projectId: string,
  key: string
): Promise<Result<RoadmapPayload>> {
  return post(projectId, { action: "claim", key });
}

export async function apiRoadmapRefresh(projectId: string): Promise<Result<RoadmapPayload>> {
  return post(projectId, { action: "refresh" });
}

async function post(
  projectId: string,
  body: Record<string, unknown>
): Promise<Result<RoadmapPayload>> {
  try {
    const res = await fetch(`/api/channel/roadmap?${q(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: "Не удалось обновить дорожную карту" };
    return { ok: true, data: (await res.json()) as RoadmapPayload };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}
