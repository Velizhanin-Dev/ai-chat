import type { AchievementsView } from "./achievements";

// ── Клиентские обёртки над /api/achievements ───────────────────────────────

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiAchievements(): Promise<Result<AchievementsView>> {
  try {
    const res = await fetch("/api/achievements", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "Не удалось загрузить достижения" };
    return { ok: true, data: (await res.json()) as AchievementsView };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Пометить показанные ачивки просмотренными (гасит метки «новое»).
export async function apiAchievementsSeen(): Promise<void> {
  try {
    await fetch("/api/achievements/seen", { method: "POST" });
  } catch {
    /* метка «новое» — не критично, погаснет при следующем заходе */
  }
}
