import { headers } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { getPlans } from "./plans";
import { describeDevice, devicesUnlimited, type DeviceView } from "./devices";

// ── Устройства: серверная часть ─────────────────────────────────────────────
// Слот занимается при ВХОДЕ (login / register / OAuth-колбэк) и освобождается,
// когда устройство удаляют из настроек. Привязка к сессии — claim `did` в JWT.

// Лимит устройств у юзера по его тарифу (включая архивный — доступ у купивших
// обязан работать, см. getPlans против getActivePlans).
export async function deviceLimitFor(user: Pick<User, "plan">): Promise<number> {
  const plan = (await getPlans()).find((p) => p.id === user.plan);
  return plan ? plan.limits.devices : 0;
}

// Сколько живёт строка устройства без активности. Совпадает со сроком жизни
// сессионного токена (30 дней в auth.ts): после него сессия всё равно мертва.
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class DeviceLimitError extends Error {
  constructor(public limit: number) {
    super(
      `Лимит устройств по тарифу — ${limit}. Зайдите с одного из активных устройств и удалите лишнее в настройках («Устройства»).`
    );
    this.name = "DeviceLimitError";
  }
}

function currentAgent(): { ua: string | null; ip: string | null } {
  try {
    const h = headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ua: h.get("user-agent"), ip };
  } catch {
    return { ua: null, ip: null };
  }
}

// Занять слот под вход.
//
// ⚠️⚠️ Повторный вход С ТОГО ЖЕ устройства слот НЕ занимает — иначе лимит сгорал бы
// за день: человек вышел и зашёл трижды с одного ноутбука, и «3 устройства»
// кончились, хотя устройство одно. Настоящего отпечатка у нас нет, поэтому
// сопоставляем по паре user-agent + ip: этого хватает, чтобы повторный вход
// переиспользовал свою строку, и не хватает, чтобы склеить разных людей за одним
// NAT'ом (у них разные браузеры... а у одинаковых — склеится, и это осознанный
// размен в пользу того, чтобы человек не оказался заперт снаружи).
//
// ⚠️ Перед проверкой лимита выкидываем протухшие: токен живёт 30 дней, после чего
// сессия мертва, а строка бы висела и держала слот вечно.
export async function registerDevice(user: Pick<User, "id" | "plan">): Promise<string> {
  const limit = await deviceLimitFor(user);
  const { ua, ip } = currentAgent();

  await prisma.device
    .deleteMany({
      where: { userId: user.id, lastSeenAt: { lt: new Date(Date.now() - DEVICE_TTL_MS) } },
    })
    .catch((err) => console.error("[devices] чистка протухших:", err));

  // Тот же браузер на том же адресе — просто продлеваем существующую строку.
  const same = await prisma.device.findFirst({
    where: { userId: user.id, userAgent: ua, ip },
    orderBy: { lastSeenAt: "desc" },
  });
  if (same) {
    await prisma.device.update({
      where: { id: same.id },
      data: { lastSeenAt: new Date() },
    });
    return same.id;
  }

  if (devicesUnlimited(limit)) {
    const row = await prisma.device.create({
      data: { userId: user.id, userAgent: ua, ip },
    });
    return row.id;
  }

  // ⚠️ Проверка и вставка одной транзакцией: два одновременных входа иначе оба
  // увидят слот свободным.
  return prisma.$transaction(async (tx) => {
    const count = await tx.device.count({ where: { userId: user.id } });
    if (count >= limit) throw new DeviceLimitError(limit);
    const row = await tx.device.create({
      data: { userId: user.id, userAgent: ua, ip },
    });
    return row.id;
  });
}

// Жив ли слот. Удалили устройство из настроек — сессия перестаёт действовать.
export async function deviceAlive(userId: string, deviceId: string): Promise<boolean> {
  const row = await prisma.device.findUnique({ where: { id: deviceId } });
  return Boolean(row && row.userId === userId);
}

// «Последний визит» устройства — с тем же троттлингом, что у User.lastSeenAt:
// писать на каждый авторизованный запрос незачем.
const SEEN_THROTTLE_MS = 5 * 60 * 1000;

export function touchDevice(deviceId: string, lastSeenAt: Date): void {
  if (Date.now() - lastSeenAt.getTime() < SEEN_THROTTLE_MS) return;
  prisma.device
    .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
    .catch((err) => console.error("[devices] touch error:", err));
}

export async function listDevices(
  userId: string,
  currentId: string | null
): Promise<DeviceView[]> {
  const rows = await prisma.device.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: describeDevice(r.userAgent),
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    current: r.id === currentId,
  }));
}

// Удалить чужое устройство. Своё (текущее) удалять нельзя — для выхода есть
// «Выйти»: иначе человек сносит собственную сессию и не понимает, что произошло.
export async function removeDevice(
  userId: string,
  id: string,
  currentId: string | null
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (id === currentId)
    return { ok: false, error: "Это текущее устройство — для выхода есть «Выйти»", status: 400 };
  const row = await prisma.device.findUnique({ where: { id } });
  if (!row || row.userId !== userId)
    return { ok: false, error: "Устройство не найдено", status: 404 };
  await prisma.device.delete({ where: { id } });
  return { ok: true };
}
