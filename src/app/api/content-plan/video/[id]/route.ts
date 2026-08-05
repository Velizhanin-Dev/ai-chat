import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { isStatus } from "@/lib/content-plan";
import { toVideoView, videoPlanId } from "@/lib/content-plan-server";

export const dynamic = "force-dynamic";

const strArr = (v: unknown, max: number): string[] | undefined =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).slice(0, max)
    : undefined;
const str = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" ? v.trim() : undefined;

// PATCH /api/content-plan/video/[id] — обновить статус и/или редактируемые поля
// (ручная правка юзера; ИИ-переделка полей — отдельным роутом /regenerate, Фаза 2).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await videoPlanId(user.id, id);
  if (!owned) return apiError("Ролик не найден", 404);

  const body = await readJson(req);
  const data: Prisma.ContentPlanVideoUpdateInput = {};

  if (typeof body?.status === "string" && isStatus(body.status)) data.status = body.status;
  if (typeof body?.order === "number") data.order = Math.round(body.order);
  if (typeof body?.noSpeaker === "boolean") data.noSpeaker = body.noSpeaker;

  const titles = strArr(body?.titles, 3);
  if (titles) data.titles = titles;
  const previews = strArr(body?.previewTexts, 3);
  if (previews) data.previewTexts = previews;
  const questions = strArr(body?.questions, 10);
  if (questions) data.questions = questions;

  for (const key of ["format", "huntStage", "pain", "nativeClose", "reference", "whyWorks", "opening"] as const) {
    const v = str(body?.[key]);
    if (v !== undefined) data[key] = v;
  }
  if (body?.cta && typeof body.cta === "object") data.cta = body.cta as Prisma.InputJsonValue;
  if (body?.visp && typeof body.visp === "object") data.visp = body.visp as Prisma.InputJsonValue;

  // Привязка/отвязка реального ролика канала (Фаза 2).
  if (body && "youtubeVideoId" in body) {
    const yt = body.youtubeVideoId;
    if (typeof yt === "string" && yt) {
      // Привязали → тянем снимок превью/просмотров с клиента и авто-статус
      // «опубликовано» (если статус явно не переопределён в этом же запросе).
      data.youtubeVideoId = yt;
      data.thumbnail = typeof body?.thumbnail === "string" ? body.thumbnail : null;
      data.views = typeof body?.views === "number" ? Math.round(body.views) : null;
      if (data.status === undefined) data.status = "published";
    } else {
      // Отвязали → чистим связь (статус не трогаем).
      data.youtubeVideoId = null;
      data.thumbnail = null;
      data.views = null;
    }
  }

  if (Object.keys(data).length === 0) return apiError("Нет изменений");

  const row = await prisma.contentPlanVideo.update({ where: { id }, data });
  return NextResponse.json({ video: toVideoView(row) });
}

// DELETE /api/content-plan/video/[id] — удалить ролик из плана.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  const owned = await videoPlanId(user.id, id);
  if (!owned) return apiError("Ролик не найден", 404);
  await prisma.contentPlanVideo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
