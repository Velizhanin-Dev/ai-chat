import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { requireProjectAccess, toRow } from "@/lib/thumbnails-server";
import { deleteUpload } from "@/lib/uploads";

// Удаление референса или генерации: сначала строка в БД, потом файл на диске
// (осиротевший файл безобиднее осиротевшей строки, которая рисует битую картинку).
export const dynamic = "force-dynamic";

// PATCH — правка метаданных строки. Пока только «применять всегда» (pinned) у
// референса: закреплённый стиль-референс подставляется во все новые генерации,
// чтобы превью канала выглядели одинаково.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const row = await prisma.thumbnail.findFirst({
    where: { id: params.id, conversationId: access.conversationId },
  });
  if (!row) return apiError("Не найдено", 404);
  if (row.kind !== "reference") return apiError("Закреплять можно только референсы");

  const pinned = Boolean(body?.pinned);
  const updated = await prisma.thumbnail.update({
    where: { id: row.id },
    data: { pinned },
  });
  return NextResponse.json({ item: toRow(updated) });
}

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
