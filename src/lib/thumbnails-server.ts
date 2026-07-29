import type { Thumbnail, User } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeRefRole, sanitizeSpec, type ThumbnailRow } from "./thumbnails";
import { getSessionUser } from "./auth";
import { isAdmin } from "./admin";
import { getSettings, isLaunchLocked } from "./settings";
import { getQuotaState } from "./quota";
import { assertOwnedProject } from "./youtube";
import { apiError } from "./http";
import { prisma } from "./prisma";

// ── Общий гейт для всех роутов генератора превью ────────────────────────────
// Раздел пока АДМИН-ОНЛИ (как и страница — она лежит в route-group (locked)).
// Открыть всем = снять этот флаг И вынести страницу из (locked); остальная
// логика (квота, гейт тарифа) уже готова и включится сама.
export const THUMBNAILS_ADMIN_ONLY = true;

// Сколько единиц квоты стоит одна сгенерированная картинка. Картинка у Nano
// Banana Pro дороже обычного ответа чата (~$0.13-0.15 против центов), но
// считаем как один запрос — так понятнее пользователю.
export const THUMBNAIL_QUOTA_COST = 1;

type Denied = { ok: false; res: NextResponse };
type Allowed = { ok: true; user: User; conversationId: string };

// Строка БД → то, что уходит клиенту. Файл отдаём ссылкой, не инлайним.
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
  };
}

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
export async function spendQuota(user: User, cost = THUMBNAIL_QUOTA_COST): Promise<void> {
  if (isAdmin(user)) return;
  await prisma.user
    .update({ where: { id: user.id }, data: { requestsUsed: { increment: cost } } })
    .catch((err) => console.error("[thumbnails] quota increment error:", err));
}
