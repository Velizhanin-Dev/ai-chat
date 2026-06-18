import { NextRequest, NextResponse } from "next/server";
import {
  isOAuthProvider,
  oauthCreds,
  buildAuthorizeUrl,
  randomState,
  pkcePair,
  OAUTH_STATE_COOKIE,
} from "@/lib/oauth";

// Старт OAuth-входа: генерим state (+ PKCE для VK), кладём в httpOnly-cookie и
// редиректим на провайдера. Колбэк — /api/auth/callback/[provider].
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const provider = params.provider;
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}`, base));

  if (!isOAuthProvider(provider)) return fail("oauth_unknown_provider");
  if (!oauthCreds(provider)) return fail("oauth_unavailable");

  const state = randomState();
  const nextParam = req.nextUrl.searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/chat";

  let verifier: string | undefined;
  let challenge: string | undefined;
  if (provider === "vk") {
    const p = pkcePair();
    verifier = p.verifier;
    challenge = p.challenge;
  }

  const authorizeUrl = buildAuthorizeUrl(provider, { state, challenge });
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: JSON.stringify({ provider, state, verifier, next }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 минут на прохождение OAuth
  });
  return res;
}
