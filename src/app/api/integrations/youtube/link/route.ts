import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { getPublicStats, linkChannel, unlinkChannel } from "@/lib/youtube-public";
import { track } from "@/lib/achievements-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Канал, привязанный ПО ССЫЛКЕ — запасной путь для тех, кто не может пройти
// Google-OAuth (канал на бренд-аккаунте компании). Даёт публичные цифры: ролики,
// просмотры, подписчиков, теги, комментарии. Удержания, CTR и источников трафика
// тут нет и быть не может — см. комментарий в src/lib/youtube-public.ts.
//
// Квоту тарифа НЕ тратит: это подключение, а не генерация.

// GET — что привязано + свежая публичная статистика (?refresh=1 мимо кэша).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const link = await prisma.channelLink.findUnique({ where: { conversationId: owned } });
  if (!link) return NextResponse.json({ linked: false, channel: null, stats: null });

  // ⚠️ Статистику отдаём только по явному запросу (?stats=1): карточка настроек
  // спрашивает лишь «привязано ли», и гонять ради неё девять units на каждый
  // показ страницы незачем.
  const wantStats = url.searchParams.get("stats") === "1";
  const stats = wantStats
    ? await getPublicStats(owned, url.searchParams.get("refresh") === "1")
    : null;

  return NextResponse.json({
    linked: true,
    channel: {
      channelId: link.channelId,
      title: link.title,
      thumbnail: link.thumbnail,
      customUrl: link.customUrl,
      subscribers: link.subscribers,
      hiddenSubs: link.hiddenSubs,
      videoCount: link.videoCount,
      views: link.views,
    },
    stats,
  });
}

// POST { projectId, url } — привязать канал по ссылке.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const input = typeof body?.url === "string" ? body.url.trim().slice(0, 300) : "";
  if (!input) return apiError("Вставьте ссылку на канал");

  // ⚠️ Если канал уже подключён через Google — по ссылке привязывать нечего:
  // полный доступ строго лучше публичного, и два источника цифр рядом только
  // запутают (какой из них показывать в разделе «Канал»?).
  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
    select: { id: true },
  });
  if (integ) {
    return apiError("Канал уже подключён через Google — по ссылке привязывать не нужно", 409);
  }

  const res = await linkChannel(owned, input);
  if (!res.ok) return apiError(res.error, 422);
  // Та же ачивка, что за OAuth-подключение: для человека это одно и то же
  // действие «подключил канал», и наказывать урезанный путь ещё и по ачивкам
  // незачем. Fire-and-forget.
  track(user.id, "youtube_connected");
  return NextResponse.json({ linked: true, channel: res.channel });
}

// DELETE ?projectId= — отвязать.
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  await unlinkChannel(owned);
  return NextResponse.json({ linked: false });
}
