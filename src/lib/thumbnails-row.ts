import type { Thumbnail, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin-role";
import {
  normalizeRefRole,
  sanitizeSpec,
  THUMBNAIL_SPEC_QUOTA_COST,
  type ThumbnailRow,
} from "@/lib/thumbnails";

// Часть thumbnails-server, которой можно пользоваться ВНЕ http-запроса.
//
// ⚠️ Зачем отдельно: thumbnails-server проверяет доступ через сессию и потому
// тянет next/headers и node-crypto. Фоновому воркеру сессия не нужна (он уже
// работает от имени проверенного пользователя), а на этом хвосте падала
// edge-компиляция instrumentation.ts. Здесь только то, что нужно обработчику
// задачи: маппинг строки наружу и списание квоты. thumbnails-server их
// реэкспортирует, поэтому прежние импорты не менялись.

export function toRow(t: Thumbnail): ThumbnailRow {
  return {
    id: t.id,
    kind: t.kind === "generation" ? "generation" : "reference",
    role: normalizeRefRole(t.role),
    label: t.label,
    url: `/api/thumbnails/${t.id}/file`,
    mimeType: t.mimeType,
    bytes: t.bytes,
    refIds: t.refIds,
    spec: t.spec ? sanitizeSpec(t.spec) : null,
    model: t.model,
    createdAt: t.createdAt.toISOString(),
    parentId: t.parentId,
    pinned: t.pinned,
  };
}

// Списание квоты. Админам не лимитируем (как и в остальных гейтах).
// Fire-and-forget по ошибке: работа уже сделана и оплачена провайдеру, ронять
// из-за счётчика нечего.
export async function spendQuota(
  user: User,
  cost = THUMBNAIL_SPEC_QUOTA_COST
): Promise<void> {
  if (isAdmin(user)) return;
  await prisma.user
    .update({ where: { id: user.id }, data: { requestsUsed: { increment: cost } } })
    .catch((err) => console.error("[quota] increment error:", err));
}
