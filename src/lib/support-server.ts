// ── Серверная часть чата поддержки: вложения ────────────────────────────────
//
// Скриншот решает половину обращений: «не работает кнопка» и «вот что я вижу» —
// это два разных обращения по объёму переписки. Поэтому к сообщению можно
// приложить картинки — и со стороны клиента, и со стороны админа (админу тоже
// нужно показать «нажми вот сюда»).
//
// ⚠️ Файлы лежат на диске (UPLOAD_DIR), в БД — только путь: скриншот на 3 МБ в
// дампе базы никому не нужен. Отдаём их роутом с проверкой доступа, а НЕ
// статикой: в переписке поддержки бывают паспорта, счета и личные данные, и
// угадываемый публичный адрес тут недопустим.

import { saveUpload, isAllowedImageMime } from "./uploads";
import {
  attachmentUrl,
  normalizeSupportRole,
  parseStoredAttachments,
  sanitizeSupportContent,
  SUPPORT_MAX_FILES,
  SUPPORT_MAX_FILE_BYTES,
  type StoredAttachment,
  type SupportMessageRow,
} from "./support";

/** Строка сообщения наружу: пути к файлам заменяются на адреса отдачи. */
export function toSupportRow(m: {
  id: string;
  role: string;
  content: string;
  attachments?: unknown;
  createdAt: Date;
}): SupportMessageRow {
  const stored = parseStoredAttachments(m.attachments);
  return {
    id: m.id,
    role: normalizeSupportRole(m.role),
    content: m.content,
    attachments: stored.map((a, i) => ({ url: attachmentUrl(m.id, i), mime: a.mime })),
    createdAt: m.createdAt.toISOString(),
  };
}

export const SUPPORT_MESSAGE_SELECT = {
  id: true,
  role: true,
  content: true,
  attachments: true,
  createdAt: true,
} as const;

export type SupportPayload =
  | { ok: true; content: string; files: { data: Buffer; mime: string }[] }
  | { ok: false; error: string };

/**
 * Прочитать тело сообщения: JSON или multipart.
 *
 * ⚠️ Оба формата, а не только multipart: JSON шлют старые клиенты и админка без
 * вложений, и ломать их ради новой возможности незачем.
 */
export async function readSupportPayload(req: Request): Promise<SupportPayload> {
  const type = req.headers.get("content-type") || "";

  if (!type.includes("multipart/form-data")) {
    const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
    const content = sanitizeSupportContent(body?.content);
    if (!content) return { ok: false, error: "Пустое сообщение" };
    return { ok: true, content, files: [] };
  }

  const form = await req.formData().catch(() => null);
  if (!form) return { ok: false, error: "Не удалось прочитать вложения" };

  const content = sanitizeSupportContent(form.get("content"));
  const raw = form.getAll("files").filter((f): f is File => f instanceof File);

  if (raw.length > SUPPORT_MAX_FILES) {
    return { ok: false, error: `Не больше ${SUPPORT_MAX_FILES} картинок за раз` };
  }
  // ⚠️ Сообщение без текста, но с картинкой — нормально: человек кидает скриншот
  // и ждёт «что это?». А вот пустое во всех смыслах отбиваем.
  if (!content && raw.length === 0) return { ok: false, error: "Пустое сообщение" };

  const files: { data: Buffer; mime: string }[] = [];
  for (const f of raw) {
    if (!isAllowedImageMime(f.type)) {
      return { ok: false, error: "Можно прикладывать только картинки: JPG, PNG или WebP" };
    }
    if (f.size > SUPPORT_MAX_FILE_BYTES) {
      return { ok: false, error: "Картинка тяжелее 8 МБ — уменьшите или обрежьте" };
    }
    files.push({ data: Buffer.from(await f.arrayBuffer()), mime: f.type });
  }

  return { ok: true, content, files };
}

/**
 * Записать вложения на диск.
 *
 * ⚠️ Раскладываем по папке ВЛАДЕЛЬЦА треда (userId), а не автора сообщения:
 * ответы админа относятся к тому же обращению, и держать их вперемешку с чужими
 * тредами — потом не разберёшься, что чьё, при ручной чистке диска.
 */
export async function saveSupportAttachments(
  files: { data: Buffer; mime: string }[],
  threadUserId: string
): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const f of files) {
    const path = await saveUpload(f.data, { mime: f.mime, dir: threadUserId, root: "support" });
    out.push({ path, mime: f.mime });
  }
  return out;
}
