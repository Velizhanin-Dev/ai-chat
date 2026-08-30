import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import { enqueueJob, findRunningJob } from "@/lib/jobs-server";

// ИИ-разбор упаковки видео (название/описание/теги/удержание) с вариантами по
// методике. ТРАТИТ 1 запрос квоты (как ответ в чате).
//
// Роут — тонкий гейт: проверяет доступ и ставит фоновую задачу. Саму работу делает
// воркер (src/lib/video-analyze-server.ts), результат клиент забирает по id задачи.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!videoId) return apiError("Не указан videoId");
  // CTR превью публичный Analytics API не отдаёт (он есть только в Studio) —
  // юзер может ввести его руками, тогда разбираем кликабельность по цифре.
  const rawCtr = Number(body?.manualCtr);
  const manualCtr = Number.isFinite(rawCtr) && rawCtr > 0 && rawCtr <= 100 ? rawCtr : null;

  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  // Бриф читает уже обработчик задачи — тут он не нужен. Подключение канала
  // проверяем здесь: так «YouTube не подключён» видно сразу, а не через минуту
  // в упавшей задаче.
  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  // Годится и канал по ссылке: разбор упаковки работает на публичных данных
  // (без кривой удержания — обработчик честно скажет об этом модели).
  if (!integ) {
    const link = await prisma.channelLink.findUnique({
      where: { conversationId: owned },
      select: { id: true },
    });
    if (!link) return apiError("YouTube не подключён", 404);
  }

  // Квота: разбор тратит 1 запрос (как ответ в чате). Админам не лимитируем.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError(
        "Срок тарифа истёк. Подключите тариф в настройках → Биллинг.",
        403,
        "PLAN_EXPIRED"
      );
    }
    if (quota.reason === "quota") {
      return apiError(
        "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
        403,
        "QUOTA_EXCEEDED"
      );
    }
  }

  // Дальше — в фон: запрос к YouTube + генерация идут десятки секунд, и уход со
  // страницы раньше убивал разбор вместе со списанной квотой. Дублей по одному и
  // тому же ролику не плодим — отдаём уже идущую задачу.
  const running = await findRunningJob({
    userId: user.id,
    kind: "video_analyze",
    conversationId: owned,
  });
  if (running && (running.result as { videoId?: string } | null)?.videoId === videoId) {
    return NextResponse.json({ job: running, duplicate: true });
  }

  const job = await enqueueJob({
    kind: "video_analyze",
    userId: user.id,
    conversationId: owned,
    payload: { videoId, manualCtr },
  });
  return NextResponse.json({ job });
}
