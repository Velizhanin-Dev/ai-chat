// Чат техподдержки — чистый модуль (общий клиенту и серверу): типы и лимиты.
// Один сквозной тред на пользователя, отдельных тикетов нет (см. модель
// SupportMessage в schema.prisma).

// Кто написал: клиент или поддержка.
export type SupportRole = "user" | "admin";

export interface SupportMessageRow {
  id: string;
  role: SupportRole;
  content: string;
  createdAt: string; // ISO
}

// Строка списка переписок в админке: юзер + хвост диалога.
export interface SupportThreadRow {
  userId: string;
  name: string;
  email: string;
  plan: string;
  lastMessage: string;
  lastRole: SupportRole;
  lastAt: string; // ISO
  // Сколько вопросов юзера админ ещё не открывал.
  unread: number;
}

// Длина одного сообщения. Верхняя граница — чтобы не залить БД и не упереться в
// лимит телеграма (там режем отдельно, см. lib/telegram.ts).
export const SUPPORT_MAX_LENGTH = 4000;

export function normalizeSupportRole(v: unknown): SupportRole {
  return v === "admin" ? "admin" : "user";
}

// Приводим пришедший текст к сохраняемому виду. Пустая строка = невалидно.
export function sanitizeSupportContent(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, SUPPORT_MAX_LENGTH);
}
