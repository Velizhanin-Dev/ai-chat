import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import { PROFILE_QUOTA_COST, sanitizeProfile } from "@/lib/project-profile";
import { generateProfile } from "@/lib/project-profile-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/projects/[id]/profile — показать разобранный профиль проекта.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  if (!(await assertOwnedProject(user.id, id))) return apiError("Проект не найден", 404);

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { profile: true, profileAt: true },
  });
  return NextResponse.json({
    profile: sanitizeProfile(conv?.profile),
    profileAt: conv?.profileAt ?? null,
  });
}

// POST /api/projects/[id]/profile — собрать профиль заново.
//
// ⚠️ Дорогая РАЗОВАЯ операция (PROFILE_QUOTA_COST): она читает бриф, данные канала
// и все изученные страницы и превращает их в выводы, которые дальше подставляются
// во ВСЕ генерации бесплатно. Пересобирать имеет смысл, когда добавились материалы
// или поменялся бриф, а не по кнопке ради кнопки.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  if (!(await assertOwnedProject(user.id, id))) return apiError("Проект не найден", 404);

  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  const res = await generateProfile({ userId: user.id, projectId: id });
  if (res.status !== "ok") return apiError(res.message, 502, "GEN_ERROR");

  if (!isAdmin(user)) {
    await prisma.user
      .update({
        where: { id: user.id },
        data: { requestsUsed: { increment: PROFILE_QUOTA_COST } },
      })
      .catch((err) => console.error("[profile] quota error:", err));
  }

  return NextResponse.json({ profile: res.profile });
}
