// ── Вложения в чате с ассистентом — чистый модуль (клиент/сервер) ───────────
//
// ⚠️ Зачем: запрос из поддержки — «удобно скрины статистики отправлять, но нет
// плюсика или скрепки». Модель чата (gpt-5.6-luna) принимает картинки и PDF,
// то есть человек может показать скриншот Творческой студии — и ассистент
// прочитает оттуда цифры (CTR, показы), которые API нам не отдаёт вовсе.
//
// Механика: файлы грузятся ДО отправки сообщения отдельным запросом
// (POST /api/chat/attachments) и ложатся на диск; в отправку чата уходят только
// «ключи» (относительные пути). Сервер сверяет, что ключ принадлежит именно
// этому проекту, кладёт вложения в сохранённое сообщение и разворачивает файлы
// в мультимодальный контент для модели.
//
// ⚠️ Картинка уходит в модель ТОЛЬКО в том ходе, где её приложили. В истории
// последующих ходов сообщение остаётся текстом — иначе каждый скриншот ездил бы
// в модель на каждое сообщение до конца диалога и разорял бы контекст.

/** Что принимаем. PDF — потому что luna умеет `file`, а людям есть что показать
 *  (медиакиты, презентации, выгрузки). Видео и прочее не берём. */
export const CHAT_ATTACH_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function isChatAttachMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHAT_ATTACH_MIME_EXT, mime);
}

// ⚠️ Четыре файла по 8 МБ — как у поддержки: скриншот-другой, а не фотоальбом.
// PDF при этом жжёт токены страницами — потолок размера тот же осознанно.
export const MAX_CHAT_FILES = 4;
export const MAX_CHAT_FILE_BYTES = 8 * 1024 * 1024;

/** Ссылка на загруженный файл, которой обмениваются клиент и сервер. */
export interface ChatAttachmentRef {
  /** Относительный путь в UPLOAD_DIR (chat/<projectId>/<uuid>.<ext>). */
  key: string;
  name: string;
  mime: string;
}

/** Адрес отдачи файла (роут проверяет владение проектом). */
export function chatAttachmentUrl(projectId: string, key: string): string {
  return `/api/chat/attachments?projectId=${encodeURIComponent(projectId)}&key=${encodeURIComponent(key)}`;
}

// dir в saveUpload санитайзится тем же правилом — повторяем его, чтобы ключ
// сходился с реальным путём на диске.
function safeDir(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Ключ принадлежит этому проекту?
 *
 * ⚠️ Это ГРАНИЦА БЕЗОПАСНОСТИ: клиент присылает ключи в отправке чата, и без
 * проверки префикса можно было бы сослаться на чужой файл (или на файл другого
 * раздела) и заставить сервер скормить его модели / отдать наружу.
 */
export function isChatAttachKeyForProject(key: string, projectId: string): boolean {
  if (typeof key !== "string" || key.length > 200 || key.includes("..")) return false;
  return new RegExp(`^chat/${safeDir(projectId)}/[\\w-]+\\.[a-z0-9]{2,5}$`).test(key);
}

/** Разбор колонки Message.attachments: мусор и чужой формат молча отбрасываем. */
export function parseChatAttachments(raw: unknown): ChatAttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((x): ChatAttachmentRef[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key : "";
      const mime = typeof o.mime === "string" ? o.mime : "";
      const name = typeof o.name === "string" ? o.name.slice(0, 120) : "";
      return key && mime ? [{ key, mime, name: name || "файл" }] : [];
    })
    .slice(0, MAX_CHAT_FILES);
}
