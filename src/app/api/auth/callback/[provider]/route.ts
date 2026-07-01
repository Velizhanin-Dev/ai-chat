import { NextRequest, NextResponse } from "next/server";
import {
  isOAuthProvider,
  fetchOAuthProfile,
  findOrCreateOAuthUser,
  OAUTH_STATE_COOKIE,
} from "@/lib/oauth";
import { signSession, sessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";

// Колбэк OAuth: сверяем state, обмениваем code на профиль, находим/создаём
// юзера, ставим сессию и редиректим на next (по умолчанию /chat). Любая
// проблема → /login?error=...
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const provider = params.provider;
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const failUrl = (code: string) => new URL(`/login?error=${code}`, base);

  // Гасим state-cookie на любом ответе.
  const clearState = (res: NextResponse) => {
    res.cookies.set({ name: OAUTH_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
    return res;
  };

  if (!isOAuthProvider(provider)) {
    return NextResponse.redirect(failUrl("oauth_unknown_provider"));
  }

  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const stateParam = sp.get("state");
  const deviceId = sp.get("device_id") ?? undefined; // VK ID отдаёт device_id

  if (sp.get("error") || !code || !stateParam) {
    return clearState(NextResponse.redirect(failUrl("oauth_denied")));
  }

  const raw = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!raw) return NextResponse.redirect(failUrl("oauth_state_missing"));

  let saved: { provider?: string; state?: string; verifier?: string; next?: string };
  try {
    saved = JSON.parse(raw);
  } catch {
    return clearState(NextResponse.redirect(failUrl("oauth_state_bad")));
  }
  if (saved.provider !== provider || saved.state !== stateParam) {
    return clearState(NextResponse.redirect(failUrl("oauth_state_mismatch")));
  }

  try {
    const profile = await fetchOAuthProfile(provider, {
      code,
      verifier: saved.verifier,
      deviceId,
    });
    const user = await findOrCreateOAuthUser(provider, profile);

    // Режим «до запуска»: внутрь только админов (см. логин).
    if (isLaunchLocked(await getSettings()) && !isAdmin(user)) {
      return clearState(NextResponse.redirect(failUrl("launch_locked")));
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    const token = await signSession(user.id);

    const next =
      saved.next && saved.next.startsWith("/") && !saved.next.startsWith("//")
        ? saved.next
        : "/app";

    const res = NextResponse.redirect(new URL(next, base));
    res.cookies.set(sessionCookie(token));
    return clearState(res);
  } catch (err) {
    console.error("[oauth callback]", provider, err);
    return clearState(NextResponse.redirect(failUrl("oauth_failed")));
  }
}
