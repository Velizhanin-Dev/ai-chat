import type { AuthUser } from "@/store/authSlice";
import type { Brief } from "@/lib/brief";

// ── Клиентская обёртка над /api/auth/* ────────────────────────────────────
// Возвращаем дискриминируемый результат, чтобы страницы показывали ошибку
// вместо try/catch на каждый вызов.

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

async function post<T>(
  path: string,
  body?: unknown,
  method: "POST" | "PATCH" = "POST"
): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as { error?: string }).error || "Что-то пошло не так" };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export function apiRegister(input: { name: string; email: string; password: string }) {
  return post<{ user: AuthUser }>("/api/auth/register", input);
}

export function apiLogin(input: { email: string; password: string }) {
  return post<{ user: AuthUser }>("/api/auth/login", input);
}

export function apiLogout() {
  return post<{ ok: true }>("/api/auth/logout");
}

export function apiVerifyEmail(token: string) {
  return post<{ ok: true }>("/api/auth/verify-email", { token });
}

export function apiResendVerification() {
  return post<{ ok: true }>("/api/auth/resend-verification");
}

export function apiUpdateProfile(input: { name: string }) {
  return post<{ user: AuthUser }>("/api/auth/me", input, "PATCH");
}

// Сохранение брифа клиента + результата DISC (онбординг / «пройти заново»).
export function apiSaveBrief(brief: Brief) {
  return post<{ user: AuthUser }>("/api/auth/brief", { brief }, "PATCH");
}

export function apiForgotPassword(email: string) {
  return post<{ ok: true }>("/api/auth/forgot-password", { email });
}

export function apiResetPassword(token: string, password: string) {
  return post<{ ok: true }>("/api/auth/reset-password", { token, password });
}

// Гидратация при загрузке: текущий юзер по cookie (или null).
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user ?? null;
  } catch {
    return null;
  }
}
