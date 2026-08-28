import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

// ── Файловое хранилище загрузок (референсы и сгенерированные превью) ─────────
// Сами картинки в БД НЕ храним (раздували бы дамп): пишем на диск в UPLOAD_DIR,
// в БД (модель Thumbnail) — только относительный путь + метаданные. В проде
// UPLOAD_DIR примонтирован volume'ом к папке рядом с проектом (docker-compose:
// ./data/uploads:/app/data/uploads), поэтому файлы переживают пересборку образа.
// Отдаём их не статикой, а через API-роут с проверкой владения проектом.

const DEFAULT_DIR = path.join(process.cwd(), "data", "uploads");
export const UPLOAD_DIR = process.env.UPLOAD_DIR?.trim() || DEFAULT_DIR;

// Что принимаем от пользователя и что умеет отдавать image-модель.
export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImageMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_EXT, mime);
}

// Абсолютный путь с защитой от обхода каталога (`../`): любой путь, вылезающий
// за UPLOAD_DIR, считаем попыткой обхода и рубим.
export function absoluteUploadPath(relPath: string): string {
  const abs = path.resolve(UPLOAD_DIR, relPath);
  const root = path.resolve(UPLOAD_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("upload_path_escape");
  }
  return abs;
}

// Записывает буфер и возвращает путь ОТНОСИТЕЛЬНО UPLOAD_DIR (его и кладём в БД).
export async function saveUpload(
  data: Buffer,
  opts: { mime: string; dir: string; root?: string }
): Promise<string> {
  const ext = IMAGE_MIME_EXT[opts.mime] ?? "bin";
  // dir приходит из наших же id (conversationId, userId) — на всякий случай
  // санитайзим. root по умолчанию "thumbnails" — так было до появления вложений
  // поддержки, и старые пути в БД остаются валидными.
  const safeDir = opts.dir.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const safeRoot = (opts.root ?? "thumbnails").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const relPath = path.posix.join(safeRoot, safeDir, `${randomUUID()}.${ext}`);
  const abs = absoluteUploadPath(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return relPath;
}

export async function readUpload(relPath: string): Promise<Buffer> {
  return fs.readFile(absoluteUploadPath(relPath));
}

// Удаление best-effort: файла могло не быть (ручная чистка папки) — это не
// повод ронять удаление строки в БД.
export async function deleteUpload(relPath: string): Promise<void> {
  try {
    await fs.unlink(absoluteUploadPath(relPath));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOENT") {
      console.error("[uploads] delete failed:", relPath, err);
    }
  }
}
