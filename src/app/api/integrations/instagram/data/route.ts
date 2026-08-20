import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  assertOwnedProject,
  fetchInstagramSnapshot,
  IgReauthError,
} from "@/lib/instagram";

export const dynamic = "force-dynamic";

// GET /api/integrations/instagram/data?projectId=&days=&refresh=1 — снимок для
// раздела «Аналитика»: аккаунт + рилсы за период с метриками.
//
// ⚠️ Периоды ограничены 90 днями: столько же максимум даёт сама статистика в
// приложении, а на большем окне мы упрёмся в лимит запросов (метрики берутся
// отдельным вызовом на каждый рилс).
const PERIODS = [7, 30, 90];

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const sp = new URL(req.url).searchParams;
  const owned = await assertOwnedProject(user.id, sp.get("projectId") ?? "");
  if (!owned) return apiError("Проект не найден", 404);

  const asked = Number(sp.get("days"));
  const days = PERIODS.includes(asked) ? asked : 30;

  try {
    const snapshot = await fetchInstagramSnapshot(owned, days, sp.get("refresh") === "1");
    if (!snapshot) return apiError("Аккаунт Instagram не подключён", 404, "IG_NOT_CONNECTED");
    return NextResponse.json({ snapshot });
  } catch (err) {
    if (err instanceof IgReauthError) {
      return apiError(err.message, 409, "IG_REAUTH");
    }
    console.error("[instagram data]", err);
    return apiError("Не удалось получить данные Instagram", 502);
  }
}
