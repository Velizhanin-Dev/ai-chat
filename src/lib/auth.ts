import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { sanitizeBrief, isBriefComplete, type Brief } from "./brief";

// ── Сессия ──────────────────────────────────────────────────────────────
// Источник правды для входа — подписанный JWT в httpOnly-cookie. Сервер не
// хранит сессии: токен самодостаточен (uid + срок). Logout = удалить cookie.

const SESSION_COOKIE = "cc_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней, в секундах

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET не задан (нужна строка ≥16 символов)");
  }
  return new TextEncoder().encode(s);
}

// ── Пароли ──────────────────────────────────────────────────────────────

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT ─────────────────────────────────────────────────────────────────

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

// ── Cookie ──────────────────────────────────────────────────────────────

export function setSessionCookie(token: string): void {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(): void {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Конфиг сессионной cookie для установки на конкретный Response (например,
// NextResponse.redirect в OAuth-колбэке — там cookies() из next/headers на
// объект редиректа не попадёт). Совместим с res.cookies.set(...).
export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

// Текущий пользователь по cookie (или null). Бьёт в БД — вызывать на сервере.
export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const uid = await verifySession(token);
  if (!uid) return null;
  // Сбой БД не должен ронять весь layout (он засевает юзера на КАЖДОЙ странице).
  // При ошибке деградируем до гостя.
  try {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (user) touchLastSeen(user);
    return user;
  } catch (err) {
    console.error("[auth] getSessionUser db error:", err);
    return null;
  }
}

// «Последний визит» — обновляем не чаще раза в SEEN_THROTTLE_MS на юзера, чтобы
// не писать в БД на каждый авторизованный запрос. Fire-and-forget: не ждём и не
// роняем запрос при ошибке (на чтение юзера это не влияет).
const SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 минут

function touchLastSeen(user: User): void {
  const last = user.lastSeenAt ? user.lastSeenAt.getTime() : 0;
  if (Date.now() - last < SEEN_THROTTLE_MS) return;
  prisma.user
    .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
    .catch((err) => console.error("[auth] touchLastSeen error:", err));
}

// Форма пользователя для клиента — без passwordHash и прочей внутрянки.
export function publicUser(u: User) {
  const brief: Brief | null = u.brief ? sanitizeBrief(u.brief) : null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    plan: u.plan,
    role: u.role,
    planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    requestsUsed: u.requestsUsed,
    emailVerified: Boolean(u.emailVerified),
    brief,
    // Источник правды «прошёл бриф» — серверный флаг briefCompletedAt; на всякий
    // дублируем фактической полнотой брифа (вдруг флаг есть, а данные битые).
    briefCompleted: Boolean(u.briefCompletedAt) && isBriefComplete(brief),
  };
}

// ── Одноразовые токены (подтверждение почты / сброс пароля) ───────────────
// В БД храним sha256(token), в письмо уходит сырой token. Так утечка дампа БД
// не даёт рабочих ссылок.

export type TokenType = "email_verify" | "password_reset";

const TTL_MS: Record<TokenType, number> = {
  email_verify: 1000 * 60 * 60 * 24, // 24 часа
  password_reset: 1000 * 60 * 60, // 1 час
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Создаёт токен данного типа, гася прежние того же типа у юзера. Возвращает
// сырой токен для ссылки.
export async function createToken(userId: string, type: TokenType): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.verificationToken.deleteMany({ where: { userId, type } });
  await prisma.verificationToken.create({
    data: {
      tokenHash: sha256(raw),
      type,
      userId,
      expiresAt: new Date(Date.now() + TTL_MS[type]),
    },
  });
  return raw;
}

// Проверяет и ПОГАШАЕТ токен. Возвращает userId или null (нет/чужой тип/истёк).
export async function consumeToken(raw: string, type: TokenType): Promise<string | null> {
  if (!raw) return null;
  const rec = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(raw) },
  });
  if (!rec || rec.type !== type) return null;
  await prisma.verificationToken.delete({ where: { id: rec.id } });
  if (rec.expiresAt < new Date()) return null;
  return rec.userId;
}
