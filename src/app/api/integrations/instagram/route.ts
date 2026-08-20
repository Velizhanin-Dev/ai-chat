import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  assertOwnedProject,
  clearInstagramCache,
  instagramConfigured,
} from "@/lib/instagram";

export const dynamic = "force-dynamic";

// GET /api/integrations/instagram?projectId= — состояние подключения аккаунта.
// DELETE — отключить (удаляем запись; отзывать токен на стороне Meta нечем —
// у Instagram Login нет revoke-эндпоинта, доступ снимается в самом приложении).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const owned = await assertOwnedProject(
    user.id,
    new URL(req.url).searchParams.get("projectId") ?? ""
  );
  if (!owned) return apiError("Проект не найден", 404);

  const row = await prisma.instagramIntegration.findUnique({
    where: { conversationId: owned },
  });

  return NextResponse.json({
    configured: instagramConfigured(),
    connected: Boolean(row),
    account: row
      ? {
          username: row.username,
          name: row.name,
          profilePicture: row.profilePicture,
          followers: row.followers,
          // По этой дате UI заранее просит переподключиться: продлить токен
          // после истечения нечем (refresh-токена у Instagram нет).
          expiresAt: row.tokenExpiresAt.toISOString(),
        }
      : null,
  });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  const owned = await assertOwnedProject(
    user.id,
    new URL(req.url).searchParams.get("projectId") ?? ""
  );
  if (!owned) return apiError("Проект не найден", 404);

  await prisma.instagramIntegration.deleteMany({ where: { conversationId: owned } });
  clearInstagramCache(owned);
  return NextResponse.json({ ok: true });
}
