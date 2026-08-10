import { createHash, randomBytes } from "crypto";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { trialExpiresAt } from "./quota";
import { getSettings } from "./settings";

// ── OAuth-вход (VK ID / Яндекс) ─────────────────────────────────────────────
// Authorization Code flow. VK ID — с PKCE (S256). Сессию после колбэка ставим
// своим JWT (см. src/lib/auth.ts). Матчим юзера по (provider, providerAccountId),
// фолбэк — по email; email у VK может отсутствовать.

export type OAuthProvider = "yandex" | "vk";

export function isOAuthProvider(v: string): v is OAuthProvider {
  return v === "yandex" || v === "vk";
}

// Cookie с антифрод-state (+ PKCE-verifier и next) на время редиректа к провайдеру.
export const OAUTH_STATE_COOKIE = "oauth_state";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// Должен совпадать с Redirect URI, прописанным в кабинете провайдера.
export function oauthRedirectUri(provider: OAuthProvider): string {
  return `${appUrl()}/api/auth/callback/${provider}`;
}

interface Creds {
  clientId: string;
  clientSecret: string;
}

// null, если провайдер не сконфигурирован (нет ключей в env). Яндексу нужен
// client_secret; VK ID работает по PKCE — secret не обязателен.
export function oauthCreds(provider: OAuthProvider): Creds | null {
  const id = provider === "yandex" ? process.env.YANDEX_CLIENT_ID : process.env.VK_CLIENT_ID;
  const secret =
    provider === "yandex" ? process.env.YANDEX_CLIENT_SECRET : process.env.VK_CLIENT_SECRET;
  if (!id) return null;
  if (provider === "yandex" && !secret) return null;
  return { clientId: id, clientSecret: secret || "" };
}

// ── PKCE / state ────────────────────────────────────────────────────────────

export function randomState(): string {
  return randomBytes(16).toString("hex");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ── Authorize URL ───────────────────────────────────────────────────────────

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  opts: { state: string; challenge?: string }
): string {
  const creds = oauthCreds(provider);
  if (!creds) throw new Error("provider_not_configured");
  const redirectUri = oauthRedirectUri(provider);

  if (provider === "yandex") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state: opts.state,
    });
    return `https://oauth.yandex.ru/authorize?${p.toString()}`;
  }

  // VK ID (PKCE)
  const p = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state: opts.state,
    code_challenge: opts.challenge ?? "",
    code_challenge_method: "S256",
    scope: "email",
  });
  return `https://id.vk.com/authorize?${p.toString()}`;
}

// ── Обмен кода на профиль ───────────────────────────────────────────────────

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  name: string;
}

export async function fetchOAuthProfile(
  provider: OAuthProvider,
  params: { code: string; verifier?: string; deviceId?: string }
): Promise<OAuthProfile> {
  const creds = oauthCreds(provider);
  if (!creds) throw new Error("provider_not_configured");

  if (provider === "yandex") {
    const tokenRes = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error("token_exchange_failed");
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("no_access_token");

    const infoRes = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${token.access_token}` },
    });
    if (!infoRes.ok) throw new Error("profile_fetch_failed");
    const info = (await infoRes.json()) as {
      id: string;
      default_email?: string;
      real_name?: string;
      display_name?: string;
      login?: string;
    };
    return {
      providerAccountId: String(info.id),
      email: info.default_email ?? null,
      name: info.real_name || info.display_name || info.login || "Пользователь",
    };
  }

  // VK ID
  if (!params.verifier || !params.deviceId) throw new Error("missing_pkce_or_device");
  const tokenRes = await fetch("https://id.vk.com/oauth2/auth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.verifier,
      client_id: creds.clientId,
      device_id: params.deviceId,
      redirect_uri: oauthRedirectUri("vk"),
    }),
  });
  if (!tokenRes.ok) throw new Error("token_exchange_failed");
  const token = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: number | string;
    email?: string;
  };
  if (!token.access_token) throw new Error("no_access_token");

  let first = "";
  let last = "";
  let email = token.email ?? null;
  let uid = token.user_id != null ? String(token.user_id) : "";

  const infoRes = await fetch("https://id.vk.com/oauth2/user_info", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      access_token: token.access_token,
    }),
  });
  if (infoRes.ok) {
    const info = (await infoRes.json()) as {
      user?: {
        user_id?: number | string;
        first_name?: string;
        last_name?: string;
        email?: string;
      };
    };
    const u = info.user;
    if (u) {
      first = u.first_name ?? "";
      last = u.last_name ?? "";
      email = u.email ?? email;
      if (u.user_id != null) uid = String(u.user_id);
    }
  }
  if (!uid) throw new Error("no_user_id");
  return {
    providerAccountId: uid,
    email,
    name: `${first} ${last}`.trim() || "Пользователь",
  };
}

// ── Найти/создать пользователя по соц-профилю ───────────────────────────────

export async function findOrCreateOAuthUser(
  provider: OAuthProvider,
  profile: OAuthProfile
): Promise<User> {
  // 1. Уже привязанный соц-аккаунт.
  const linked = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });
  if (linked) return linked.user;

  const email = profile.email ? profile.email.trim().toLowerCase() : null;

  // 2. Тот же email → привязываем соц к существующему юзеру.
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      await prisma.oAuthAccount.create({
        data: { provider, providerAccountId: profile.providerAccountId, userId: byEmail.id },
      });
      return byEmail;
    }
  }

  // 3. Новый пользователь (без пароля). Если email нет — синтетический плейсхолдер.
  // Как и при обычной регистрации — пробный тариф на срок из настроек
  // (AppSettings.trialHours, правится в админке).
  const { trialHours } = await getSettings();
  return prisma.user.create({
    data: {
      email: email ?? `${provider}_${profile.providerAccountId}@oauth.local`,
      name: profile.name,
      emailVerified: email ? new Date() : null,
      planExpiresAt: trialExpiresAt(trialHours),
      oauthAccounts: {
        create: { provider, providerAccountId: profile.providerAccountId },
      },
    },
  });
}
