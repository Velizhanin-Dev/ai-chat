import type { CompetitorOrder, CompetitorResult } from "./competitors";

// Клиентские обёртки над /api/competitors.

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

export interface CompetitorContextView {
  configured: boolean;
  channelConnected: boolean;
  channelTitle: string;
  suggested: string[];
  quota: {
    day: string;
    perKeyUnits: number;
    keys: { index: number; units: number; dead: null | "quota" | "invalid" }[];
    remaining: number;
  };
  searchCost: number;
}

async function unwrap<T>(res: Response): Promise<Result<T>> {
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!res.ok || !data) {
    return {
      ok: false,
      error: data?.error ?? "Не удалось выполнить запрос",
      code: data?.code,
    };
  }
  return { ok: true, data };
}

export async function apiCompetitorContext(
  projectId: string
): Promise<Result<CompetitorContextView>> {
  try {
    const res = await fetch(`/api/competitors?projectId=${encodeURIComponent(projectId)}`);
    return unwrap<CompetitorContextView>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiCompetitorSearch(args: {
  projectId: string;
  queries: string[];
  periodDays: number;
  order: CompetitorOrder;
  force?: boolean;
}): Promise<Result<{ result: CompetitorResult; cached: boolean }>> {
  try {
    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return unwrap<{ result: CompetitorResult; cached: boolean }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}
