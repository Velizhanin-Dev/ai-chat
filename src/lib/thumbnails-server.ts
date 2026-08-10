import type { Thumbnail, User } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  normalizeRefRole,
  sanitizeSpec,
  THUMBNAIL_GENERATE_QUOTA_COST,
  THUMBNAIL_SPEC_QUOTA_COST,
  type ThumbnailRow,
} from "./thumbnails";
import { getSessionUser } from "./auth";
import { isAdmin } from "./admin-role";
import { getSettings, isLaunchLocked } from "./settings";
import { getQuotaState } from "./quota";
import { assertOwnedProject } from "./youtube";
import { apiError } from "./http";
import { prisma } from "./prisma";
// toRow/spendQuota вынесены в thumbnails-row.ts (нужны фоновому воркеру, где нет
// сессии). Реэкспортируем, чтобы прежние импорты из thumbnails-server работали.
export { toRow, spendQuota } from "./thumbnails-row";

// ── Общий гейт для всех роутов генератора превью ────────────────────────────
// Раздел открыт всем залогиненным (страница вынесена из route-group (locked),
// в меню помечена бетой). Флаг оставлен как рубильник: поставить true — раздел
// снова станет админ-онли (тогда и страницу вернуть в (locked)).
export const THUMBNAILS_ADMIN_ONLY = false;

// Стоимость операций генератора превью — в ./thumbnails (общий клиент/сервер).
export { THUMBNAIL_GENERATE_QUOTA_COST, THUMBNAIL_SPEC_QUOTA_COST };

type Denied = { ok: false; res: NextResponse };
type Allowed = { ok: true; user: User; conversationId: string };

// Строка БД → то, что уходит клиенту. Файл отдаём ссылкой, не инлайним.

// Авторизация + владение проектом (+ pre-launch и админ-онли). Возвращает
// внутренний id проекта — дальше работаем только с ним, не с сырым вводом.
export async function requireProjectAccess(
  projectId: string
): Promise<Allowed | Denied> {
  const user = await getSessionUser();
  if (!user) return { ok: false, res: apiError("Не авторизованы", 401) };

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return { ok: false, res: apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED") };
  }
  // Не светим существование раздела не-админам — 404, как в /admin.
  if (THUMBNAILS_ADMIN_ONLY && !isAdmin(user)) {
    return { ok: false, res: apiError("Not found", 404) };
  }

  const conversationId = await assertOwnedProject(user.id, projectId);
  if (!conversationId) return { ok: false, res: apiError("Проект не найден", 404) };

  return { ok: true, user, conversationId };
}

// Доступ к конкретному файлу (у ссылки на картинку нет projectId в URL):
// владение проверяем через владельца проекта, к которому привязана строка.
export async function requireAsset(
  id: string
): Promise<{ ok: true; filePath: string; mimeType: string } | Denied> {
  const user = await getSessionUser();
  if (!user) return { ok: false, res: apiError("Не авторизованы", 401) };
  if (THUMBNAILS_ADMIN_ONLY && !isAdmin(user)) {
    return { ok: false, res: apiError("Not found", 404) };
  }
  const row = await prisma.thumbnail.findFirst({
    where: { id, conversation: { userId: user.id } },
    select: { filePath: true, mimeType: true },
  });
  if (!row) return { ok: false, res: apiError("Не найдено", 404) };
  return { ok: true, filePath: row.filePath, mimeType: row.mimeType };
}

// Гейт тарифа/квоты — тот же, что у чата и ИИ-разбора видео. Админам не лимитируем.
export async function checkQuota(user: User): Promise<Denied | null> {
  if (isAdmin(user)) return null;
  const quota = await getQuotaState(user);
  if (quota.reason === "expired") {
    return {
      ok: false,
      res: apiError(
        "Срок тарифа истёк. Подключите тариф в настройках → Биллинг.",
        403,
        "PLAN_EXPIRED"
      ),
    };
  }
  if (quota.reason === "quota") {
    return {
      ok: false,
      res: apiError(
        "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
        403,
        "QUOTA_EXCEEDED"
      ),
    };
  }
  return null;
}

// Списание после УСПЕШНОЙ генерации (провал квоту не тратит). Fire-and-forget.
