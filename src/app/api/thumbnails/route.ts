import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/http";
import { requireProjectAccess, toRow } from "@/lib/thumbnails-server";
import { saveUpload, isAllowedImageMime } from "@/lib/uploads";
import {
  MAX_REFERENCES,
  MAX_REFERENCE_BYTES,
  normalizeRefRole,
} from "@/lib/thumbnails";

// Список истории проекта (референсы + генерации) и загрузка нового референса.
// Файлы лежат на диске (UPLOAD_DIR), в БД — пути; наружу отдаём ссылкой.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const items = await prisma.thumbnail.findMany({
    where: { conversationId: access.conversationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ items: items.map(toRow) });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("Ожидается multipart/form-data");
  }

  const projectId = String(form.get("projectId") ?? "");
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const file = form.get("file");
  if (!(file instanceof File)) return apiError("Файл не передан");
  if (!isAllowedImageMime(file.type)) {
    return apiError("Поддерживаются JPG, PNG и WebP");
  }
  if (file.size > MAX_REFERENCE_BYTES) {
    return apiError(`Файл больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ`);
  }

  // Потолок на проект — чтобы диск не разъезжался и в промпт не улетало 30 картинок.
  const existing = await prisma.thumbnail.count({
    where: { conversationId: access.conversationId, kind: "reference" },
  });
  if (existing >= MAX_REFERENCES) {
    return apiError(
      `Больше ${MAX_REFERENCES} референсов на проект — удалите лишние`,
      400,
      "REF_LIMIT"
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const filePath = await saveUpload(buf, {
    mime: file.type,
    dir: access.conversationId,
  });

  const row = await prisma.thumbnail.create({
    data: {
      conversationId: access.conversationId,
      userId: access.user.id,
      kind: "reference",
      role: normalizeRefRole(form.get("role")),
      label: String(form.get("label") ?? "").trim().slice(0, 120),
      filePath,
      mimeType: file.type,
      bytes: buf.length,
    },
  });

  return NextResponse.json({ item: toRow(row) });
}
