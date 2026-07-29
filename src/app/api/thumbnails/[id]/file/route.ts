import { apiError } from "@/lib/http";
import { requireAsset } from "@/lib/thumbnails-server";
import { readUpload } from "@/lib/uploads";

// Отдача картинки с диска. Не статика: файл сначала сверяется с владельцем
// проекта (ссылка вида /api/thumbnails/<id>/file, cookie уходит сама —
// same-origin). Кэш приватный и вечный: содержимое по id не меняется.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAsset(params.id);
  if (!access.ok) return access.res;

  try {
    const data = await readUpload(access.filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": access.mimeType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    // Строка есть, файла нет — папку чистили руками или потеряли volume.
    console.error("[thumbnails file] read failed:", access.filePath, err);
    return apiError("Файл не найден на диске", 404);
  }
}
