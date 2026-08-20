import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, getSessionUser, hasSessionCookie, publicUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

// Текущий пользователь по cookie — для гидратации клиента после перезагрузки.
export async function GET() {
  const user = await getSessionUser();
  // ⚠️ Подпись токена валидна, а юзера нет — почти всегда это значит, что
  // устройство отключили в настройках («Устройства»). Гасим cookie ЗДЕСЬ: в
  // серверном рендере страницы её трогать нельзя, а middleware проверяет только
  // подпись и без этого пускала бы человека в приложение, где он выглядит гостем.
  if (!user && hasSessionCookie()) clearSessionCookie();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}

// Обновление профиля (пока только имя — «как обращаться»). Email не меняем:
// смена потребовала бы повторного подтверждения (отдельный флоу).
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const body = await readJson(req);
  const name = String(body?.name ?? "").trim();
  if (name.length < 2) return apiError("Укажите имя");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name },
  });
  return NextResponse.json({ user: publicUser(updated) });
}
