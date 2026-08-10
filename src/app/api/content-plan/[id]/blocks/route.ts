import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { BLOCKS, type BlockKey } from "@/lib/content-plan";
import { planConversation } from "@/lib/content-plan-server";
import { enqueueJob, findRunningJob } from "@/lib/jobs-server";

export const dynamic = "force-dynamic";


// POST /api/content-plan/[id]/blocks — сгенерировать опорный блок плана:
// audience | hunt | funnel (1 запрос) или shorts (5 запросов). Возвращает
// обновлённый план целиком.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  const owned = await planConversation(user.id, id);
  if (!owned) return apiError("План не найден", 404);

  const body = await readJson(req);
  const block = typeof body?.block === "string" ? body.block : "";
  if (!(BLOCKS as readonly string[]).includes(block)) return apiError("Неизвестный блок");
  const key = block as BlockKey;

  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  // В фон — как и сама генерация плана. Обычно блоки ставит воркер сам следом за
  // планом; этот роут остаётся для ручной пересборки конкретного блока.
  const dup = await findRunningJob({
    userId: user.id,
    kind: "content_plan_block",
    conversationId: owned,
  });
  if (dup) return NextResponse.json({ job: dup, duplicate: true });

  const job = await enqueueJob({
    kind: "content_plan_block",
    userId: user.id,
    conversationId: owned,
    payload: { planId: id, block: key },
  });
  return NextResponse.json({ job });
}
