import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertOwnedProject, instagramAuthUrl, instagramConfigured } from "@/lib/instagram";

export const dynamic = "force-dynamic";

// GET /api/integrations/instagram/connect?projectId=&next= — старт OAuth.
//
// ⚠️ Какой проект подключаем и куда вернуться, кладём в httpOnly-cookie, а не в
// сам state: state видит и может подменить кто угодно, а привязка чужого аккаунта
// к чужому проекту — это утечка данных. В state — только случайная строка для
// сверки (CSRF), как в YouTube-колбэке.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  if (!instagramConfigured()) {
    return apiError("Интеграция с Instagram не настроена", 503, "IG_NOT_CONFIGURED");
  }

  const sp = new URL(req.url).searchParams;
  const owned = await assertOwnedProject(user.id, sp.get("projectId") ?? "");
  if (!owned) return apiError("Проект не найден", 404);

  const rawNext = sp.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : `/${owned}/settings`;

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(instagramAuthUrl(state));
  res.cookies.set({
    name: "ig_oauth_state",
    value: JSON.stringify({ state, projectId: owned, next }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
