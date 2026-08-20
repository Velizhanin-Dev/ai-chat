import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  assertOwnedProject,
  clearInstagramCache,
  exchangeCode,
  fetchAccount,
} from "@/lib/instagram";

export const dynamic = "force-dynamic";

// GET /api/integrations/instagram/callback — возврат с экрана согласия Meta.
//
// Куда возвращаться и какой проект подключаем — из httpOnly-cookie, поставленной
// на старте (см. connect). Ошибки не бросаем страницей: возвращаем человека туда,
// откуда он ушёл, с ?ig=<код>, а раздел показывает понятный текст.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  const jar = cookies();
  const raw = jar.get("ig_oauth_state")?.value;
  const saved = raw ? (safeParse(raw) ?? null) : null;
  const back = (code: string) =>
    clearState(NextResponse.redirect(new URL(`${saved?.next ?? "/app"}?ig=${code}`, base)));

  if (!saved) return back("state");
  // Человек нажал «Отмена» на экране Meta — это не ошибка, просто возвращаем.
  if (sp.get("error")) return back("cancelled");
  if (!sp.get("state") || sp.get("state") !== saved.state) return back("state");

  const user = await getSessionUser();
  if (!user) return back("auth");
  const owned = await assertOwnedProject(user.id, saved.projectId);
  if (!owned) return back("project");

  const code = sp.get("code") ?? "";
  if (!code) return back("failed");

  try {
    const { token, userId, expiresAt } = await exchangeCode(code);
    const account = await fetchAccount(token);

    await prisma.instagramIntegration.upsert({
      where: { conversationId: owned },
      create: {
        conversationId: owned,
        igUserId: userId || account.id,
        username: account.username,
        name: account.name,
        profilePicture: account.profilePicture,
        followers: account.followers,
        accessToken: token,
        tokenExpiresAt: expiresAt,
      },
      update: {
        igUserId: userId || account.id,
        username: account.username,
        name: account.name,
        profilePicture: account.profilePicture,
        followers: account.followers,
        accessToken: token,
        tokenExpiresAt: expiresAt,
      },
    });
    clearInstagramCache(owned);
    return back("connected");
  } catch (err) {
    console.error("[instagram callback]", err);
    return back("failed");
  }
}

function safeParse(v: string): { state: string; projectId: string; next: string } | null {
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    if (typeof o.state !== "string" || typeof o.projectId !== "string") return null;
    return {
      state: o.state,
      projectId: o.projectId,
      next: typeof o.next === "string" ? o.next : "/app",
    };
  } catch {
    return null;
  }
}

function clearState(res: NextResponse): NextResponse {
  res.cookies.set({ name: "ig_oauth_state", value: "", path: "/", maxAge: 0 });
  return res;
}
