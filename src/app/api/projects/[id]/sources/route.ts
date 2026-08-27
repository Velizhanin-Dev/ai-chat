import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { assertOwnedProject } from "@/lib/youtube";
import { sanitizeBrief } from "@/lib/brief";
import { isSourceKind, MAX_SOURCES, SOURCE_QUOTA_COST } from "@/lib/project-profile";
import { analyzeSource } from "@/lib/project-profile-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Материалы клиента: страницы, изученные в проекте.
//
// ⚠️ Главный способ их завести — прислать ссылку В ЧАТ («изучи вот это»): там
// страница читается сразу и запоминается сама (см. chat-pages.ts). Этот роут —
// про работу со списком: посмотреть, разобрать подробно, удалить.

// GET — список источников проекта.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  if (!(await assertOwnedProject(user.id, id))) return apiError("Проект не найден", 404);

  const sources = await prisma.projectSource.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: MAX_SOURCES,
    select: {
      id: true,
      url: true,
      title: true,
      kind: true,
      digest: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ sources });
}

// POST — изучить страницу и РАЗОБРАТЬ её (оффер, выгоды, возражения, цены).
// Тело: { url, kind? }. Стоит SOURCE_QUOTA_COST запросов.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const { id } = await params;
  if (!(await assertOwnedProject(user.id, id))) return apiError("Проект не найден", 404);

  const body = await readJson(req);
  const url = typeof body?.url === "string" ? body.url.trim().slice(0, 2000) : "";
  if (!url) return apiError("Нужна ссылка на страницу");
  const kind = isSourceKind(body?.kind) ? body.kind : "site";

  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") return apiError("Срок тарифа истёк.", 403, "PLAN_EXPIRED");
    if (quota.reason === "quota") {
      return apiError("Запросы на тарифе закончились.", 403, "QUOTA_EXCEEDED");
    }
  }

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { brief: true },
  });

  const res = await analyzeSource({
    userId: user.id,
    projectId: id,
    url,
    brief: conv?.brief ? sanitizeBrief(conv.brief) : null,
  });

  // ⚠️ «Страница на скриптах» — не ошибка сервера, а честное состояние: содержимое
  // рисует JavaScript, и в HTML пусто. Человеку надо сказать это словами.
  if (res.status === "empty") {
    return apiError(
      "Страница открылась, но текста в ней нет — содержимое подгружается скриптами. Пришлите ссылку попроще или текст.",
      422,
      "PAGE_EMPTY"
    );
  }
  if (res.status === "error") return apiError(res.message, 502, "PAGE_ERROR");

  const existing = await prisma.projectSource.findFirst({
    where: { conversationId: id, url },
    select: { id: true },
  });

  const data = {
    title: res.title,
    kind,
    digest: res.digest as unknown as object,
    text: res.text.slice(0, 20000),
  };
  const source = existing
    ? await prisma.projectSource.update({ where: { id: existing.id }, data })
    : await prisma.projectSource.create({
        data: { conversationId: id, url, ...data },
      });

  if (!isAdmin(user)) {
    await prisma.user
      .update({
        where: { id: user.id },
        data: { requestsUsed: { increment: SOURCE_QUOTA_COST } },
      })
      .catch((err) => console.error("[sources] quota error:", err));
  }

  return NextResponse.json({ source });
}

// DELETE ?sourceId= — убрать материал из проекта.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const { id } = await params;
  if (!(await assertOwnedProject(user.id, id))) return apiError("Проект не найден", 404);

  const sourceId = new URL(req.url).searchParams.get("sourceId") ?? "";
  if (!sourceId) return apiError("Не указан материал");

  await prisma.projectSource.deleteMany({ where: { id: sourceId, conversationId: id } });
  return NextResponse.json({ ok: true });
}
