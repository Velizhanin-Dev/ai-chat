import type { User } from "@prisma/client";

// Проверка роли БЕЗ доступа к сессии — вынесена из admin.ts отдельным модулем.
//
// ⚠️ Зачем отдельный файл: admin.ts импортирует getSessionUser из auth.ts, а тот —
// next/headers и node-crypto. Кто импортировал isAdmin, тянул за собой весь этот
// хвост. Фоновому воркеру (src/lib/worker.ts) сессия не нужна вовсе — он работает
// вне запроса, — и на этом хвосте падала edge-компиляция instrumentation.ts
// («Module not found: Can't resolve 'crypto'»). Здесь только чистая функция.

function bootstrapEmails(): string[] {
  return (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(u: User | null | undefined): boolean {
  if (!u) return false;
  if (u.role === "admin") return true;
  return bootstrapEmails().includes(u.email.toLowerCase());
}
