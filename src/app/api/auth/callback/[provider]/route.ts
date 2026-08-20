import { NextRequest, NextResponse } from "next/server";
import {
  isOAuthProvider,
  fetchOAuthProfile,
  findOrCreateOAuthUser,
  OAUTH_STATE_COOKIE,
} from "@/lib/oauth";
import { signSession, sessionCookie } from "@/lib/auth";
import { DeviceLimitError, registerDevice } from "@/lib/devices-server";
import { prisma } from "@/lib/prisma";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { readUtmTouchCookie } from "@/lib/utm-server";

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
    // Метку первого касания на сервере видно только через cookie: сюда мы попали
    // после редиректов на провайдера, localStorage тут недоступен.
    const user = await findOrCreateOAuthUser(provider, profile, readUtmTouchCookie());

    // Режим «до запуска»: внутрь только админов (см. логин).
    if (isLaunchLocked(await getSettings()) && !isAdmin(user)) {
      return clearState(NextResponse.redirect(failUrl("launch_locked")));
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    // Слот устройства по тарифу (⚠️ deviceId выше — это PKCE-параметр VK, другое).
    let sessionDeviceId: string;
    try {
      sessionDeviceId = await registerDevice(user);
    } catch (e) {
      if (e instanceof DeviceLimitError)
        return clearState(NextResponse.redirect(failUrl("device_limit")));
      throw e;
    }
    const token = await signSession(user.id, sessionDeviceId);

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
