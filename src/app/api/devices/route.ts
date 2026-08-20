import { NextResponse } from "next/server";
import { currentDeviceId, getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { deviceLimitFor, listDevices } from "@/lib/devices-server";

export const dynamic = "force-dynamic";

// GET /api/devices — активные устройства аккаунта + лимит тарифа.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const [devices, limit] = await Promise.all([
    listDevices(user.id, await currentDeviceId()),
    deviceLimitFor(user),
  ]);
  return NextResponse.json({ devices, limit });
}
