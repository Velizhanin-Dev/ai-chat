import type { User } from "@prisma/client";
import { getSessionUser } from "./auth";
// isAdmin живёт отдельно (admin-role.ts) — чтобы его можно было использовать вне
// http-запроса, не таща за собой сессию и node-crypto. Тут — реэкспорт для
// прежних импортов `from "@/lib/admin"`.
import { isAdmin } from "./admin-role";

export { isAdmin };

// ── Гейт админки ─────────────────────────────────────────────────────────────
// Доступ проверяем на СЕРВЕРЕ по User.role (читается из БД через getSessionUser).
// JWT/middleware не трогаем — роль всегда свежая, без релогина. Не-админу отдаём
// 404 (страница notFound, API — 404), чтобы не светить существование админки.
//
// Бутстрап первого админа: задать роль в БД напрямую (Prisma Studio / SQL) или
// через ADMIN_BOOTSTRAP_EMAILS в env (список почт через запятую) — такой юзер
// считается админом даже без role="admin". Удобно поднять себя на проде разово.


// Текущий админ или null. Вызывать на сервере (страницы /admin, /api/admin/*).
export async function getAdminUser(): Promise<User | null> {
  const u = await getSessionUser();
  return isAdmin(u) ? u : null;
}
