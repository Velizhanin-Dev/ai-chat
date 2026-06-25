import type { User } from "@prisma/client";
import { getSessionUser } from "./auth";

// ── Гейт админки ─────────────────────────────────────────────────────────────
// Доступ проверяем на СЕРВЕРЕ по User.role (читается из БД через getSessionUser).
// JWT/middleware не трогаем — роль всегда свежая, без релогина. Не-админу отдаём
// 404 (страница notFound, API — 404), чтобы не светить существование админки.
//
// Бутстрап первого админа: задать роль в БД напрямую (Prisma Studio / SQL) или
// через ADMIN_BOOTSTRAP_EMAILS в env (список почт через запятую) — такой юзер
// считается админом даже без role="admin". Удобно поднять себя на проде разово.

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

// Текущий админ или null. Вызывать на сервере (страницы /admin, /api/admin/*).
export async function getAdminUser(): Promise<User | null> {
  const u = await getSessionUser();
  return isAdmin(u) ? u : null;
}
