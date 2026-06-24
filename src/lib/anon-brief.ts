// ── Анонимный бриф (страница по QR-коду) ───────────────────────────────────
// Страница /brief анонимна (юзера/сессии нет), сохранять на бэкенд некуда. Поэтому
// готовый бриф кладём в localStorage устройства. При следующей регистрации/входе
// в ТОМ ЖЕ браузере AppShell подхватывает его и отправляет на бэкенд (apiSaveBrief),
// после чего аккаунт сразу считается с пройденным брифом — повторно проходить не
// нужно. Работает только на том же устройстве/браузере — это норм для QR-сценария.
//
// Чистый клиентский модуль (всё под guard на window): brief.ts должен оставаться
// серверо-безопасным, поэтому localStorage живёт здесь, а не там.

import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";

// Готовый анонимный бриф (в общем неймспейсе приложения creative-chat:*-v1).
const ANON_BRIEF_KEY = "creative-chat:anon-brief-v1";

export function readAnonBrief(): Brief | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ANON_BRIEF_KEY);
    if (!raw) return null;
    const brief = sanitizeBrief(JSON.parse(raw));
    // Храним только реально завершённый бриф (с типом DISC) — иначе мостить нечего.
    return isBriefComplete(brief) ? brief : null;
  } catch {
    return null;
  }
}

export function writeAnonBrief(brief: Brief) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ANON_BRIEF_KEY, JSON.stringify(sanitizeBrief(brief)));
  } catch {
    /* приватный режим / превышена квота — не критично */
  }
}

export function clearAnonBrief() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ANON_BRIEF_KEY);
  } catch {
    /* ignore */
  }
}
