import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import {
  assertOwnedProject,
  getValidAccessToken,
  hasWriteScope,
  updateVideoMetadata,
  clearStatsCache,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/integrations/youtube/apply — записать новое название / описание / теги
// РОЛИКУ НА КАНАЛЕ. Тело: { projectId, videoId, title?, description?, tags? }.
//
// ⚠️ Это единственное место во всём продукте, которое ПИШЕТ на канал пользователя.
// Поэтому: правим ровно те поля, что пришли (см. updateVideoMetadata), меняем один
// ролик за вызов и ничего не делаем фоном — только по явному нажатию.
//
// ⚠️ Квоту тарифа не тратим: работа уже оплачена разбором, который эти варианты
// придумал. По API это 51 unit (чтение snippet + запись) на нашем OAuth-подключении.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!projectId || !videoId) return apiError("Не указан проект или ролик");
  if (!(await assertOwnedProject(user.id, projectId))) return apiError("Проект не найден", 404);

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 100) : undefined;
  const description =
    typeof body?.description === "string" ? body.description.slice(0, 5000) : undefined;
  const tags = Array.isArray(body?.tags)
    ? body.tags
        .filter((t: unknown): t is string => typeof t === "string")
        .map((t: string) => t.trim())
        .filter(Boolean)
        .slice(0, 60)
    : undefined;

  if (title === undefined && description === undefined && tags === undefined) {
    return apiError("Нечего применять");
  }

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: projectId },
  });
  if (!integ) return apiError("Канал не подключён", 409, "NOT_CONNECTED");

  // ⚠️ Право на запись выдаётся на экране согласия Google, и у каналов, подключённых
  // ДО появления этой кнопки, его нет. Проверяем ДО похода в API, чтобы человек
  // получил внятное «переподключите канал», а не 403 из недр YouTube.
  if (!hasWriteScope(integ.scope)) {
    return apiError(
      "Чтобы применять правки, переподключите канал — нужно новое разрешение YouTube",
      403,
      "SCOPE_REQUIRED"
    );
  }

  try {
    const token = await getValidAccessToken(integ);
    const res = await updateVideoMetadata(token, videoId, { title, description, tags });
    if (!res.ok) {
      return apiError(
        res.message,
        res.reason === "not_found" ? 404 : res.reason === "forbidden" ? 403 : 502,
        res.reason === "forbidden" ? "SCOPE_REQUIRED" : undefined
      );
    }
    // Снимок дашборда держит старое название — сбрасываем, иначе человек применит
    // правку и увидит в разделе прежний заголовок.
    clearStatsCache(projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[youtube apply]", err);
    return apiError("Не удалось применить изменения", 502);
  }
}
