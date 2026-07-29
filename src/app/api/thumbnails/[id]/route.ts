import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/http";
import { requireProjectAccess } from "@/lib/thumbnails-server";
import { deleteUpload } from "@/lib/uploads";

// Удаление референса или генерации: сначала строка в БД, потом файл на диске
// (осиротевший файл безобиднее осиротевшей строки, которая рисует битую картинку).
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const row = await prisma.thumbnail.findFirst({
    where: { id: params.id, conversationId: access.conversationId },
  });
  if (!row) return apiError("Не найдено", 404);

  await prisma.thumbnail.delete({ where: { id: row.id } });
  await deleteUpload(row.filePath);

  return NextResponse.json({ ok: true });
}
