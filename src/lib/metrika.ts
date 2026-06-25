// Яндекс.Метрика — тонкая обёртка. Счётчик подключается в YandexMetrika (layout)
// только если задан NEXT_PUBLIC_YM_ID. Все функции безопасны без счётчика и на
// сервере (no-op) — и никогда не роняют UX (ошибки глотаем).
//
// ВАЖНО: NEXT_PUBLIC_* инлайнится на этапе сборки. На проде (Docker) переменная
// должна быть в окружении BUILD-стадии, иначе в бандл попадёт undefined.

export const YM_ID = process.env.NEXT_PUBLIC_YM_ID;

type YmFn = (id: string | number, action: string, ...args: unknown[]) => void;

function ym(): YmFn | null {
  if (typeof window === "undefined" || !YM_ID) return null;
  const fn = (window as unknown as { ym?: YmFn }).ym;
  return typeof fn === "function" ? fn : null;
}

// Достижение цели (reachGoal). target — id цели, заведённой в кабинете Метрики.
export function ymGoal(target: string, params?: Record<string, unknown>): void {
  const fn = ym();
  if (!fn) return;
  try {
    fn(YM_ID as string, "reachGoal", target, params);
  } catch {
    /* метрика не критична — не мешаем приложению */
  }
}

// Просмотр страницы (для SPA-навигаций, где нет полной перезагрузки).
export function ymHit(url: string): void {
  const fn = ym();
  if (!fn) return;
  try {
    fn(YM_ID as string, "hit", url);
  } catch {
    /* no-op */
  }
}
