// Последний активный проект — чтобы при следующем заходе сразу открыть его
// (а не пустой экран «выберите проект»). Храним id + userId в localStorage
// (scoped по юзеру, чтобы на общем браузере чужой проект не подтянулся).
// Восстанавливаем только если проект реально есть в списке (см. AppShell-загрузчик).

const KEY = "creative-chat:last-project-v1";

export function writeLastProject(userId: string, id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, id }));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

export function readLastProject(userId: string): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { userId?: string; id?: string };
    return d && d.userId === userId && typeof d.id === "string" ? d.id : null;
  } catch {
    return null;
  }
}
