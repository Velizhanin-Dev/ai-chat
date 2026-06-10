import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";

// Генерация короткого КОНТЕКСТНОГО заголовка диалога по первому сообщению юзера —
// как в ChatGPT/Claude (слева не сырой текст запроса, а тема: «хук для видео»,
// «приветственный диалог» и т.п.). Дешёвая haiku, без стрима.
const TITLE_MODEL = "claude-haiku-4-5";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message =
      typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : "";
    if (!message) {
      return Response.json({ error: "message обязателен" }, { status: 400 });
    }

    const res = await getAnthropic().messages.create({
      model: TITLE_MODEL,
      max_tokens: 24,
      system:
        "Ты придумываешь короткий заголовок для диалога по первому сообщению пользователя. " +
        "Верни ТОЛЬКО заголовок: 2–5 слов, по сути запроса (тема/намерение), на русском, " +
        "без кавычек, без точки в конце, с заглавной буквы. " +
        'Примеры: «привет» → Приветственный диалог; «сделай хук для видео про кофе» → Хук для видео про кофе; ' +
        "«придумай идею для рилса» → Идея для рилса.",
      messages: [{ role: "user", content: message }],
    });

    const text = res.content.find((b) => b.type === "text");
    const title =
      text && text.type === "text"
        ? text.text.trim().replace(/^["«»']+|["«»'.]+$/g, "").slice(0, 60)
        : "";

    return Response.json({ title });
  } catch (err) {
    console.error("Title error:", err);
    return Response.json({ error: "Не удалось сгенерировать заголовок" }, { status: 500 });
  }
}
