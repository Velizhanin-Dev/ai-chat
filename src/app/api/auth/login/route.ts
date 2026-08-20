import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSession,
  setSessionCookie,
  publicUser,
} from "@/lib/auth";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { DeviceLimitError, registerDevice } from "@/lib/devices-server";

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

  // Режим «до запуска»: пускаем внутрь только админов (страница входа открыта,
  // но обычный юзер сессию не получает). Проверка серверная — не обходится.
  if (isLaunchLocked(await getSettings()) && !isAdmin(user)) {
    return apiError("Доступ к ассистенту откроется после запуска", 403);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  // Слот устройства по тарифу. Свободных нет — сессию не выдаём и говорим, что
  // делать (удалить лишнее устройство с любого из уже вошедших).
  let deviceId: string;
  try {
    deviceId = await registerDevice(user);
  } catch (err) {
    if (err instanceof DeviceLimitError) return apiError(err.message, 403, "DEVICE_LIMIT");
    throw err;
  }

  setSessionCookie(await signSession(user.id, deviceId));
  return NextResponse.json({ user: publicUser(user) });
}
