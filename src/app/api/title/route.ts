import { NextRequest } from "next/server";
import { generateTitle } from "@/lib/llm/title";
import { getSettings } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";

// Короткий контекстный заголовок диалога по первому сообщению. Движок —
// ГЛОБАЛЬНЫЙ (выбран в админке): Claude больше не зашит, заголовок делает та же
// модель, что и отвечает в чате (см. src/lib/llm/title.ts). Стат пишется внутри.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message =
      typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : "";
    if (!message) {
      return Response.json({ error: "message обязателен" }, { status: 400 });
    }
    const conversationId =
      typeof body?.conversationId === "string" ? body.conversationId : null;

    const [{ provider }, user] = await Promise.all([getSettings(), getSessionUser()]);
    const title = await generateTitle(provider, message, {
      userId: user?.id ?? null,
      conversationId,
    });
    return Response.json({ title });
  } catch (err) {
    console.error("Title error:", err);
    return Response.json({ error: "Не удалось сгенерировать заголовок" }, { status: 500 });
  }
}
