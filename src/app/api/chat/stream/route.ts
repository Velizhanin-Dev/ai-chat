import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { SSE_HEADERS, getRun, streamRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/chat/stream?runId=…&from=N — подключиться к идущей (или только что
// завершившейся) генерации и дочитать её.
//
// ⚠️ Ради этого роута генерация и вынесена из POST /api/chat в прогон: обновил
// страницу — вкладка возвращается сюда и получает хвост с позиции `from`, а не
// теряет ответ. `from` — сколько символов ответа у клиента уже есть; 0 = отдать
// всё с начала (обычный случай после перезагрузки, там Redux пуст).
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });
  }

  const runId = req.nextUrl.searchParams.get("runId") ?? "";
  const fromRaw = Number(req.nextUrl.searchParams.get("from") ?? "0");
  const from = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.floor(fromRaw) : 0;

  const run = getRun(runId, user.id);
  // Прогона нет: он либо завершился давно и вычищен, либо чужой. Ответ в таком
  // случае уже лежит в истории диалога — клиент просто перезагрузит сообщения.
  if (!run) {
    return NextResponse.json({ error: "Генерация не найдена", code: "RUN_GONE" }, { status: 404 });
  }

  return new Response(streamRun(run, from), { headers: SSE_HEADERS });
}
