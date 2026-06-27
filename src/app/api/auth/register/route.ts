import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  signSession,
  setSessionCookie,
  publicUser,
} from "@/lib/auth";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { trialExpiresAt } from "@/lib/quota";

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

  // Выдаём пробный тариф ВСЕГО на 1 час (срок). Число запросов в этот час —
  // из Plan.limits.requests тарифа "start" (правится в админке). После окончания
  // пробного — только переход на платный тариф, заново триал не выдаётся.
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      planExpiresAt: trialExpiresAt(),
    },
  });

  // Режим «до запуска»: аккаунт создаём (ранняя регистрация), но внутрь не пускаем
  // никого, кроме админов — сессию и письмо не выдаём (как и логин). После старта
  // юзер просто войдёт. Bootstrap-админ по почте проходит (isAdmin по email).
  if (isLaunchLocked(await getSettings()) && !isAdmin(user)) {
    return apiError("Доступ к ассистенту откроется после запуска", 403);
  }

  // Подтверждение почты убрали (verify-gate off, страница /verify-email удалена) —
  // письмо не шлём, сразу логиним и пускаем в чат.
  setSessionCookie(await signSession(user.id));
  return NextResponse.json({ user: publicUser(user) });
}
