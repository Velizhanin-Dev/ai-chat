import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { stopRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";

// POST /api/chat/stop — «Остановить». Тело: { runId }.
//
// ⚠️ Раньше остановкой был ОБРЫВ соединения (AbortController на клиенте), и он же
// случался при обновлении страницы — то есть отличить «человек передумал» от
// «страница перезагрузилась» было нельзя, и ответ терялся в обоих случаях. Теперь
// останов — явное действие, а обрыв соединения генерацию не трогает.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const body = await readJson(req);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "Нет runId" }, { status: 400 });

  // Прогона может уже не быть (успел завершиться) — это не ошибка.
  stopRun(runId, user.id);
  return NextResponse.json({ ok: true });
}
