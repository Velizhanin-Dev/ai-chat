import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { readUpload, saveUpload } from "@/lib/uploads";
import {
  CHAT_ATTACH_MIME_EXT,
  isChatAttachKeyForProject,
  isChatAttachMime,
  MAX_CHAT_FILES,
  MAX_CHAT_FILE_BYTES,
  type ChatAttachmentRef,
} from "@/lib/chat-attachments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Вложения чата с ассистентом (скриншоты статистики, PDF).
//
// POST — загрузка ДО отправки сообщения: multipart (projectId + files), файлы
//        ложатся на диск, наружу уходят ключи. Сообщение потом ссылается на них.
// GET  — отдача файла по ключу. ⚠️ Роутом с проверкой владения, НЕ статикой:
//        в чат кидают личные кабинеты и цифры, угадываемый адрес недопустим.

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("Ожидается multipart/form-data");
  }

  const projectId = String(form.get("projectId") ?? "");
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return apiError("Файлы не переданы");
  if (files.length > MAX_CHAT_FILES) {
    return apiError(`Не больше ${MAX_CHAT_FILES} файлов за раз`);
  }

  const out: ChatAttachmentRef[] = [];
  for (const f of files) {
    if (!isChatAttachMime(f.type)) {
      return apiError("Можно прикладывать картинки (JPG, PNG, WebP) и PDF");
    }
    if (f.size > MAX_CHAT_FILE_BYTES) {
      return apiError(
        `Файл тяжелее ${Math.round(MAX_CHAT_FILE_BYTES / 1024 / 1024)} МБ — уменьшите`
      );
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const key = await saveUpload(buf, { mime: f.type, dir: owned, root: "chat" });
    out.push({ key, name: (f.name || "файл").slice(0, 120), mime: f.type });
  }

  return NextResponse.json({ files: out });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Not found", 404);

  const key = url.searchParams.get("key") ?? "";
  // ⚠️ Ключ обязан лежать в папке ИМЕННО этого проекта — иначе, зная чужой ключ,
  // можно было бы вытянуть файл через свой проект.
  if (!isChatAttachKeyForProject(key, owned)) return apiError("Not found", 404);

  try {
    const data = await readUpload(key);
    const ext = key.slice(key.lastIndexOf(".") + 1);
    const mime =
      Object.entries(CHAT_ATTACH_MIME_EXT).find(([, e]) => e === ext)?.[0] ??
      "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return apiError("Not found", 404);
  }
}
