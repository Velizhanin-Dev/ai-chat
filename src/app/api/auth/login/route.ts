import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSession,
  setSessionCookie,
  publicUser,
} from "@/lib/auth";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return apiError("Некорректный запрос");

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!EMAIL_RE.test(email) || !password) {
    return apiError("Неверная почта или пароль", 401);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Один и тот же текст для «нет юзера» / «пароль не подошёл» / «вход только
  // через соцсеть» (passwordHash=null у OAuth-юзеров) — без энумерации.
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return apiError("Неверная почта или пароль", 401);
  }

  setSessionCookie(await signSession(user.id));
  return NextResponse.json({ user: publicUser(user) });
}
