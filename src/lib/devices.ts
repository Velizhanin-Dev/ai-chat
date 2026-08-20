// ── Устройства (активные сессии) — чистый модуль, общий клиенту и серверу ────
//
// Лимит устройств задаётся в тарифе (Plan.limits.devices) и правится в админке.
// ⚠️ 0 и -1 значат ОДНО И ТО ЖЕ — «без ограничения». Ноль отдельным смыслом не
// нагружаем намеренно: у тарифов, заведённых до появления поля, его в JSON нет,
// normalizeLimits подставит 0, и трактовка «ноль устройств» заперла бы вход всем.

export interface DeviceView {
  id: string;
  label: string; // «Chrome · Windows»
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean; // это устройство, с которого сейчас смотрят
}

export function devicesUnlimited(limit: number): boolean {
  return limit <= 0;
}

// Человекочитаемое имя устройства из user-agent. Задача не «разобрать UA
// правильно» (это в принципе невозможно), а дать человеку узнать свой вход:
// хватает браузера и системы.
export function describeDevice(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s) return "Неизвестное устройство";

  const browser =
    /Edg\//.test(s) ? "Edge"
    : /YaBrowser/.test(s) ? "Яндекс.Браузер"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /Firefox\//.test(s) ? "Firefox"
    // Chrome-строку содержат все хромоподобные, поэтому проверяем её ПОСЛЕ них.
    : /Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : "Браузер";

  const os =
    /iPhone|iPad|iPod/.test(s) ? "iOS"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /Linux/.test(s) ? "Linux"
    : "";

  return os ? `${browser} · ${os}` : browser;
}
