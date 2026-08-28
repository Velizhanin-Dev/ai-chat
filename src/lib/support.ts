// Чат техподдержки — чистый модуль (общий клиенту и серверу): типы и лимиты.
// Один сквозной тред на пользователя, отдельных тикетов нет (см. модель
// SupportMessage в schema.prisma).

// Кто написал: клиент или поддержка.
export type SupportRole = "user" | "admin";

/** Одна прикреплённая картинка в том виде, в котором её видит клиент. */
export interface SupportAttachment {
  /** Адрес отдачи: /api/support/attachments/<messageId>/<index>. */
  url: string;
  mime: string;
}

export interface SupportMessageRow {
  id: string;
  role: SupportRole;
  content: string;
  attachments: SupportAttachment[];
  createdAt: string; // ISO
}

/** То, что лежит в SupportMessage.attachments (наружу пути не отдаём). */
export interface StoredAttachment {
  path: string;
  mime: string;
}

// Сколько картинок к одному сообщению и какого размера.
//
// ⚠️ Четыре — не «пусть будет»: скриншот проблемы это обычно один-два кадра, а
// десяток картинок в бабблах превращает переписку в ленту, где не найти текст.
export const SUPPORT_MAX_FILES = 4;
export const SUPPORT_MAX_FILE_BYTES = 8 * 1024 * 1024;

export function attachmentUrl(messageId: string, index: number): string {
  return `/api/support/attachments/${messageId}/${index}`;
}

/** Разбор колонки attachments: чужой формат и мусор молча отбрасываем. */
export function parseStoredAttachments(raw: unknown): StoredAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((x): StoredAttachment[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const path = typeof o.path === "string" ? o.path : "";
      const mime = typeof o.mime === "string" ? o.mime : "";
      return path && mime ? [{ path, mime }] : [];
    })
    .slice(0, SUPPORT_MAX_FILES);
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
