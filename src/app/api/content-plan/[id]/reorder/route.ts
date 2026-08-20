import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { isStatus } from "@/lib/content-plan";
import { planConversation, toVideoView } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";

// POST /api/content-plan/[id]/reorder — новый порядок карточек ОДНОЙ колонки.
//
// Приходит статус колонки и её карточки сверху вниз; сохраняем order = позиция и
// заодно ставим статус (карточку могли перетащить из соседней колонки — тогда и
// переезд, и место в списке делаются одним запросом, без гонки двух PATCH'ей).
//
// ⚠️ order у карточек плана — общее числовое поле, и одинаковые значения в РАЗНЫХ
// колонках нормальны: карточки сравниваются только внутри своей колонки. Поэтому
// перенумеровываем лишь затронутую колонку, а не весь план.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const body = await readJson(req);
  const status = typeof body?.status === "string" && isStatus(body.status) ? body.status : null;
  if (!status) return apiError("Неизвестный статус колонки");

  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
  if (ids.length === 0) return apiError("Пустой список карточек");

  // Чужие карточки в список попасть не должны — сверяем принадлежность плану.
  const own = await prisma.contentPlanVideo.findMany({
    where: { planId: id, id: { in: ids } },
    select: { id: true },
  });
  if (own.length !== ids.length) return apiError("Карточка не найдена", 404);

  await prisma.$transaction(
    ids.map((videoId, index) =>
      prisma.contentPlanVideo.update({
        where: { id: videoId },
        data: { order: index, status },
      })
    )
  );

  const rows = await prisma.contentPlanVideo.findMany({
    where: { planId: id },
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ videos: rows.map(toVideoView) });
}
