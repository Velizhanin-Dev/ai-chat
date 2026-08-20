import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  signSession,
  setSessionCookie,
  publicUser,
} from "@/lib/auth";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";
import { registerDevice } from "@/lib/devices-server";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { trialExpiresAt } from "@/lib/quota";
import { sanitizeTouch, utmToRow, hasUtm } from "@/lib/utm";
import { readUtmTouchCookie } from "@/lib/utm-server";

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

  // Пробный тариф на срок из настроек (AppSettings.trialHours). Число запросов в
  // этот срок — из Plan.limits.requests тарифа "start" (редактор тарифов). Заново
  // сам по себе триал не выдаётся — только сбросом из админки.
  const { trialHours } = await getSettings();
  // Первое касание (откуда человек пришёл) — с клиента, из localStorage. Пишем
  // ровно при создании аккаунта и больше не трогаем: это источник регистрации.
  // Фолбэк на cookie — на случай, когда localStorage недоступен (приватный режим).
  const fromBody = sanitizeTouch(body.utm);
  const touch = hasUtm(fromBody) || fromBody.referrer ? fromBody : readUtmTouchCookie();
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      planExpiresAt: trialExpiresAt(trialHours),
      ...utmToRow(touch),
      utmReferrer: touch.referrer || null,
      utmLanding: touch.landing || null,
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
  // Новый аккаунт — первое устройство, слот всегда свободен (лимит проверяется
  // тем же registerDevice, что и на входе).
  const deviceId = await registerDevice(user).catch(() => undefined);
  setSessionCookie(await signSession(user.id, deviceId));
  return NextResponse.json({ user: publicUser(user) });
}
