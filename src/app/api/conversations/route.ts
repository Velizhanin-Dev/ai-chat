import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { sanitizeBrief, isBriefComplete } from "@/lib/brief";
import { getPlans } from "@/lib/plans";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { attachPendingConnection } from "@/lib/youtube";
import { normalizePlatform, type Platform } from "@/lib/platform";
import { track } from "@/lib/achievements-server";
import { ensureProfileJob } from "@/lib/project-profile-server";

// Список диалогов текущего пользователя — только метаданные (id/title/даты),
// без сообщений. Сообщения тянутся лениво по клику (GET /api/conversations/[id]).
// Свежие сверху. Лимит — отсечка на случай очень большой истории.
const LIST_LIMIT = 200;
const TITLE_MAX = 80;

export type ConversationMeta = {
  id: string;
  title: string;
  /** Площадка проекта: "youtube" | "instagram" (см. src/lib/platform.ts). */
  platform: Platform;
  createdAt: string;
  updatedAt: string;
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите, чтобы посмотреть историю", 401);

  const rows = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, platform: true, createdAt: true, updatedAt: true },
    take: LIST_LIMIT,
  });

  const conversations: ConversationMeta[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    platform: normalizePlatform(c.platform),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return NextResponse.json({ conversations });
}

// Создание проекта (1 проект = 1 диалог) после прохождения брифа. Бриф крепится
// к диалогу (Conversation.brief), заголовок = название канала из брифа. Лимит
// числа проектов берём из тарифа (Plan.limits.projects, -1 = без лимита) — больше
// слотов создать нельзя, пока не удалишь проект (продаём удобство). Админам — без
// лимита; в режиме «до запуска» создавать проекты могут только админы.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Войдите, чтобы создать проект", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  if (!body) return apiError("Некорректный запрос");

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 64) return apiError("Некорректный id проекта");

  const brief = sanitizeBrief(body.brief);
  if (!isBriefComplete(brief)) return apiError("Бриф не пройден", 400, "BRIEF_REQUIRED");

  const platform = normalizePlatform(body.platform);

  // ⚠️ Instagram пока ТОЛЬКО админам: интеграция написана, но не обкатана на живом
  // аккаунте (нужны ключи Meta и профессиональный профиль). Для остальных площадка
  // показывается как «в разработке» — см. PlatformStep. Гейт серверный: на клиенте
  // карточку можно обойти запросом.
  if (platform === "instagram" && !isAdmin(user)) {
    return apiError("Instagram пока в разработке", 403, "INSTAGRAM_IN_DEV");
  }

  // Лимиты по тарифу (админам не лимитируем). ⚠️ У Instagram СВОЙ счётчик: тариф
  // может давать пять проектов на YouTube и один на Instagram, поэтому общий лимит
  // projects и лимит instagram проверяются отдельно, а не «в сумме».
  if (!isAdmin(user)) {
    const plans = await getPlans();
    const plan = plans.find((p) => p.id === user.plan);
    const limit = plan ? plan.limits.projects : 0;
    if (limit !== -1) {
      const count = await prisma.conversation.count({ where: { userId: user.id } });
      if (count >= limit) {
        return apiError(
          "Достигнут лимит проектов на тарифе. Удалите проект, чтобы создать новый.",
          403,
          "PROJECT_LIMIT"
        );
      }
    }

    if (platform === "instagram") {
      const igLimit = plan ? plan.limits.instagram : 0;
      if (igLimit === 0) {
        return apiError(
          "На этом тарифе Instagram недоступен — выберите тариф, где он есть.",
          403,
          "INSTAGRAM_NOT_IN_PLAN"
        );
      }
      if (igLimit !== -1) {
        const igCount = await prisma.conversation.count({
          where: { userId: user.id, platform: "instagram" },
        });
        if (igCount >= igLimit) {
          return apiError(
            "Достигнут лимит проектов на Instagram. Удалите проект, чтобы создать новый.",
            403,
            "INSTAGRAM_LIMIT"
          );
        }
      }
    }
  }

  const title = (brief.channel || "").trim().slice(0, TITLE_MAX) || "Новый проект";

  try {
    const conv = await prisma.conversation.create({
      data: {
        id,
        userId: user.id,
        title,
        platform,
        brief: brief as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, title: true, platform: true, createdAt: true, updatedAt: true },
    });
    // Канал, подключённый на шаге брифа (проекта тогда ещё не было), переезжает на
    // созданный проект — только если клиент явно об этом просит (иначе брошенный
    // черновик подключения прицепился бы к чужому по смыслу проекту). Best-effort:
    // не вышло — проект живёт, канал подключат в настройках проекта.
    if (body.attachChannel === true) await attachPendingConnection(user.id, conv.id);
    // Геймификация (docs/achievements.md): проект создан, а бриф пройден — иначе
    // создание бы не прошло валидацию выше. Fire-and-forget.
    track(user.id, "project_created");
    track(user.id, "brief_done");
    // Профиль проекта собирается САМ, в фоне: человек прошёл бриф и идёт писать
    // сценарии, а не заказывать «разбор проекта». Пока задача считается, ответы
    // строятся по брифу — как раньше. Fire-and-forget: сбой не роняет создание.
    void ensureProfileJob({ userId: user.id, projectId: conv.id, hasProfile: false });
    const conversation: ConversationMeta = {
      id: conv.id,
      title: conv.title,
      platform: normalizePlatform(conv.platform),
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    };
    return NextResponse.json({ conversation });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError("Проект с таким id уже существует", 409);
    }
    console.error("[conversations] create error:", err);
    return apiError("Не удалось создать проект", 500);
  }
}
