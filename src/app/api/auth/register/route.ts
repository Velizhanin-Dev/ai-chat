import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  signSession,
  setSessionCookie,
  createToken,
  publicUser,
} from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/mail";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return apiError("Некорректный запрос");

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (name.length < 2) return apiError("Укажите имя");
  if (!EMAIL_RE.test(email)) return apiError("Введите корректный email");
  if (password.length < 8) return apiError("Пароль минимум 8 символов");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return apiError("Аккаунт с такой почтой уже зарегистрирован", 409);

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password) },
  });

  // Режим «до запуска»: аккаунт создаём (ранняя регистрация), но внутрь не пускаем
  // никого, кроме админов — сессию и письмо не выдаём (как и логин). После старта
  // юзер просто войдёт. Bootstrap-админ по почте проходит (isAdmin по email).
  if (isLaunchLocked(await getSettings()) && !isAdmin(user)) {
    return apiError("Доступ к ассистенту откроется после запуска", 403);
  }

  // Письмо для подтверждения отправляем, но вход не блокируем (verify-gate off).
  const token = await createToken(user.id, "email_verify");
  await sendVerificationEmail(email, token);

  setSessionCookie(await signSession(user.id));
  return NextResponse.json({ user: publicUser(user) });
}
