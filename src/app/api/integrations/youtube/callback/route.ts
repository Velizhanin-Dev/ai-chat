import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  exchangeCode,
  fetchChannelInfo,
  assertOwnedProject,
  YT_STATE_COOKIE,
} from "@/lib/youtube";
import { track } from "@/lib/achievements-server";
import { clearPublicChannelCache } from "@/lib/youtube-public";

// Колбэк подключения YouTube: сверяем state, меняем code на токены, тянем канал и
// сохраняем интеграцию КОНКРЕТНОМУ проекту (projectId из state-cookie). Возвращаем
// на страницу-инициатор (next) с ?yt=<status> для понятного тоста.
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  const clearState = (res: NextResponse) => {
    res.cookies.set({ name: YT_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
    return res;
  };

  const raw = req.cookies.get(YT_STATE_COOKIE)?.value;
  let saved: { state?: string; next?: string; projectId?: string; draft?: boolean } = {};
  try {
    if (raw) saved = JSON.parse(raw);
  } catch {
    /* битая cookie — обработаем как отсутствие state ниже */
  }
  const next =
    saved.next && saved.next.startsWith("/") && !saved.next.startsWith("//")
      ? saved.next
      : "/app";

  const back = (status: string) =>
    clearState(
      NextResponse.redirect(
        new URL(`${next}${next.includes("?") ? "&" : "?"}yt=${status}`, base)
      )
    );

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/app", base));

  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const stateParam = sp.get("state");

  if (sp.get("error") || !code || !stateParam) return back("denied");
  if (!saved.state || saved.state !== stateParam) return back("state");

  // Черновик (подключение на шаге брифа) — проекта ещё нет, привязываем к юзеру.
  const draft = Boolean(saved.draft);
  // Проект должен по-прежнему существовать и принадлежать юзеру.
  const owned = draft ? null : await assertOwnedProject(user.id, saved.projectId || "");
  if (!draft && !owned) return back("noproject");

  try {
    const tokens = await exchangeCode(code);
    const channel = await fetchChannelInfo(tokens.access_token);
    if (!channel) return back("nochannel");

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    if (draft) {
      const fields = {
        channelId: channel.channelId,
        title: channel.title,
        thumbnail: channel.thumbnail,
        customUrl: channel.customUrl,
        accessToken: tokens.access_token,
        tokenExpiresAt,
        scope: tokens.scope ?? null,
      };
      await prisma.youTubePendingConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, refreshToken: tokens.refresh_token ?? null, ...fields },
        update: {
          ...fields,
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        },
      });
      return back("connected");
    }

    // refresh_token Google отдаёт только при первом согласии (мы просим
    // prompt=consent всегда, но подстрахуемся): сохраняем, только если пришёл.
    await prisma.youTubeIntegration.upsert({
      where: { conversationId: owned! },
      create: {
        conversationId: owned!,
        channelId: channel.channelId,
        title: channel.title,
        thumbnail: channel.thumbnail,
        customUrl: channel.customUrl,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt,
        scope: tokens.scope ?? null,
      },
      update: {
        channelId: channel.channelId,
        title: channel.title,
        thumbnail: channel.thumbnail,
        customUrl: channel.customUrl,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        tokenExpiresAt,
        scope: tokens.scope ?? null,
      },
    });
    // ⚠️ Канал, привязанный ранее ПО ССЫЛКЕ, убираем: полный доступ строго лучше
    // публичного, а два источника цифр рядом — источник путаницы (какой из них
    // показывать в разделе «Канал»?). Инвариант: либо OAuth, либо ссылка.
    await prisma.channelLink
      .deleteMany({ where: { conversationId: owned! } })
      .catch((err) => console.error("[youtube] снятие привязки по ссылке:", err));
    clearPublicChannelCache(owned!);

    // Геймификация (docs/achievements.md), fire-and-forget. Только для реального
    // подключения к проекту — черновик на шаге брифа не считаем, он ещё может
    // не доехать до проекта.
    track(user.id, "youtube_connected");
    return back("connected");
  } catch (err) {
    console.error("[youtube callback]", err);
    return back("failed");
  }
}
