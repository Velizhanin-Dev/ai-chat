import type { DeviceView } from "@/lib/devices";

// Клиентская обёртка над /api/devices (раздел «Устройства» в настройках аккаунта).

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(path: string, method: "GET" | "DELETE" = "GET"): Promise<Result<T>> {
  try {
    const res = await fetch(path, { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return { ok: false, error: (data as { error?: string }).error || "Что-то пошло не так" };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export function apiDevices() {
  return call<{ devices: DeviceView[]; limit: number }>("/api/devices");
}

export function apiRemoveDevice(id: string) {
  return call<{ ok: true }>(`/api/devices/${id}`, "DELETE");
}
