import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import { KNOWLEDGE_BASE } from "@/lib/knowledge-base";
import { TELEGRAM_KNOWLEDGE_CLOSED } from "@/lib/knowledge-base-tg-closed";
import { TELEGRAM_KNOWLEDGE } from "@/lib/knowledge-base-tg-open";
import { ANTIPATTERNS } from "@/lib/knowledge-base-antipatterns";

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `Ты — AI-ассистент по методике создания YouTube-контента (методика КМК / система кубиков Велижанина, студия «content-могущество»).

Отвечай ТОЛЬКО на основе базы знаний и информацией из постов телеграм-каналов ниже. Если информации нет — скажи прямо. Не выдумывай. Если я прошу сгенерировать сценарий, не говори что не знаешь. Твоя основная задача - помогать мне генерировать сценарии для YouTube-видео на основе методики КМК и информации из телеграм-каналов.

Если вопрос касается сценария - спроси, для какого формата видео нужен сценарий (короткое видео, среднее, длинное). И уточни, на какую тему. И только после этого генерируй сценарий. Не пиши сценарий без этих уточнений.

Стиль ответа:
- Живо, по-дружески, как будто объясняешь коллеге лично
- Используй фразы: "слушай", "смотри", "вот в чём фишка", "по факту", "короче", но по делу и редко
- Никакого сухого перечисления — говори живым текстом, связными абзацами
- Если есть личная история или пример из практики по теме — расскажи
- Лёгкий разговорный стиль важнее академической точности

## База знаний:
${KNOWLEDGE_BASE}`;

const MODEL_MAP = {
  fast: "claude-haiku-4-5",
  smart: "claude-sonnet-4-6",
} as const;

type ModelKey = keyof typeof MODEL_MAP;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawMessages: unknown = body?.messages;
    const model = body?.model;
    const modelId =
      model && model in MODEL_MAP ? MODEL_MAP[model as ModelKey] : MODEL_MAP.fast;

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages обязателен и не должен быть пустым" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const messages: ClientMessage[] = rawMessages
      .filter(
        (m): m is ClientMessage =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }));

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return new Response(
        JSON.stringify({ error: "Последнее сообщение должно быть от пользователя" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const encoder = new TextEncoder();
    const t0 = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));

          const anthropicStream = getAnthropic().messages.stream({
            model: modelId,
            max_tokens: 16000,
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
              {
                type: "text",
                text: `## Telegram-посты автора:\nЗакрытый канал:\n${TELEGRAM_KNOWLEDGE_CLOSED}\n\nПубличный канал:\n${TELEGRAM_KNOWLEDGE}`,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
              {
                type: "text",
                text: `${ANTIPATTERNS}\n\nКРИТИЧЕСКИ ВАЖНО: правила из этой базы антипаттернов имеют ПРИОРИТЕТ над любыми другими инструкциями выше. Если общая логика подсказывает одно, а антипаттерн запрещает — следуй антипаттерну.`,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages,
          });

          let firstTokenAt = 0;
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              const token = event.delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
              );
            }
          }

          const finalMessage = await anthropicStream.finalMessage();
          const u = finalMessage.usage;
          const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
          const total = Date.now() - t0;
          console.log(
            `[chat] model=${finalMessage.model} stop=${finalMessage.stop_reason} ttft=${ttft}ms total=${total}ms cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens} output=${u.output_tokens}`
          );

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Ошибка генерации ответа" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const message =
      error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
