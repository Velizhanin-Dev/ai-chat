import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { findActiveRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";

// GET /api/chat/active?conversationId=… — идёт ли прямо сейчас генерация в этом
// проекте. Вкладка спрашивает при открытии чата: если да — подключается к ней
// через /api/chat/stream и дорисовывает ответ.
//
// ⚠️ Источник правды — сервер, а не localStorage: так ответ подхватывается и
// после перезагрузки, и в другой вкладке, и на другом устройстве (в пределах
// одного инстанса — реестр прогонов in-memory).
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId") ?? "";
  if (!conversationId) return NextResponse.json({ run: null });

  return NextResponse.json({ run: findActiveRun(conversationId, user.id) });
}
