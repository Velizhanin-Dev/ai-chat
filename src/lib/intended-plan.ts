// Намерение оформить тариф с лендинга. Кнопка «Оформить» в тарифах ведёт в чат;
// чтобы там сразу показать окно тарифов (Настройки → Биллинг), на клик пишем сюда
// id выбранного тарифа. AppShell на входе в приложение читает ключ, открывает
// биллинг ОДИН раз и тут же чистит ключ (повторно окно не всплывёт).
// Только клиент (localStorage). Best-effort: приватный режим/квота — не критично.

const KEY = "creative-chat:intended-plan-v1";

export function writeIntendedPlan(planId: string): void {
  try {
    localStorage.setItem(KEY, planId);
  } catch {
    /* приватный режим / квота — не критично */
  }
}

export function readIntendedPlan(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearIntendedPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
