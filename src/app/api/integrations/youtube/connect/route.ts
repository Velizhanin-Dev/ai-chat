import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  youtubeConfigured,
  buildYouTubeAuthUrl,
  randomState,
  assertOwnedProject,
  YT_STATE_COOKIE,
} from "@/lib/youtube";

// Старт подключения YouTube к КОНКРЕТНОМУ проекту: юзер уже залогинен (иначе на
// /login). Сверяем владение проектом, генерим state, кладём в httpOnly-cookie
// (+ projectId и куда вернуться) и редиректим на согласие Google.
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/app", base));

  const nextParam = req.nextUrl.searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/app";

  const withStatus = (path: string, status: string) =>
    new URL(`${path}${path.includes("?") ? "&" : "?"}yt=${status}`, base);

  const projectId = req.nextUrl.searchParams.get("projectId") || "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return NextResponse.redirect(withStatus(next, "noproject"));

  // Нет Google-ключей на сервере → нечем подключать.
  if (!youtubeConfigured()) {
    return NextResponse.redirect(withStatus(next, "unavailable"));
  }

  const state = randomState();
  const res = NextResponse.redirect(buildYouTubeAuthUrl(state));
  res.cookies.set({
    name: YT_STATE_COOKIE,
    value: JSON.stringify({ state, next, projectId: owned }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 минут на прохождение OAuth
  });
  return res;
}
