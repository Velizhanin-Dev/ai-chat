import { NextResponse } from "next/server";
import { currentDeviceId, getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { removeDevice } from "@/lib/devices-server";

export const dynamic = "force-dynamic";

// DELETE /api/devices/[id] — отключить ЧУЖОЕ устройство (своё удалять нельзя,
// для этого есть «Выйти»). Может любой, кто вошёл в аккаунт.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const res = await removeDevice(user.id, id, await currentDeviceId());
  if (!res.ok) return apiError(res.error, res.status);
  return NextResponse.json({ ok: true });
}
