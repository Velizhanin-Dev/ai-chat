import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Гейт защищённых роутов на edge: до рендера проверяем подписанный JWT в
// httpOnly-cookie `cc_session`. Нет cookie / битая подпись / истёк срок →
// редирект на /login (с `next` для возврата). Email-подтверждение здесь НЕ
// проверяем (verify-gate выключен) — только факт валидной сессии.
//
// Важно: middleware крутится на edge-runtime — никакого Prisma/Node-API/
// next/headers. Поэтому повторяем минимальную проверку токена через `jose`
// (та же логика, что `verifySession` в src/lib/auth.ts), не импортируя
// серверный модуль auth.

const SESSION_COOKIE = "cc_session";

function secretKey(): Uint8Array | null {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const key = secretKey();
  if (!key) return false; // секрет не задан — фейлимся закрыто (на /login)
  try {
    const { payload } = await jwtVerify(token, key);
    return typeof payload.uid === "string";
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  // /api сами отвечают гостю (401/403 JSON) — не редиректим их в HTML /login.
  // (matcher `/:projectId/chat` иначе поймал бы /api/chat.)
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  if (await hasValidSession(req)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Гейтим приложение: экран без проекта (/app) и разделы проекта
// (/{projectId}/chat|channel|creatives|reviews|settings). Гость → /login.
// Не-админа на закрытых разделах дополнительно отсекает серверный гвард
// route-group (locked) (404). Лендинг и auth-страницы остаются открытыми.
export const config = {
  matcher: [
    "/app",
    "/:projectId/chat",
    "/:projectId/chat/:path*",
    "/:projectId/channel",
    "/:projectId/channel/:path*",
    "/:projectId/creatives",
    "/:projectId/creatives/:path*",
    "/:projectId/reviews",
    "/:projectId/reviews/:path*",
    "/:projectId/settings",
    "/:projectId/settings/:path*",
  ],
};
