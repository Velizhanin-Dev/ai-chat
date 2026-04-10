import { NextRequest } from "next/server";
import { validateScriptTopic, hydeScriptSearch, buildScriptPrompt } from "@/lib/rag";
import { getOpenAI } from "@/lib/openai";

export async function POST(request: NextRequest) {
  try {
    const { topic } = await request.json();

    if (!topic?.trim()) {
      return new Response(
        JSON.stringify({ error: "Тема не может быть пустой" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const validation = await validateScriptTopic(topic);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.message }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const { chunks, speaker } = await hydeScriptSearch(topic);

    const systemPrompt = buildScriptPrompt(topic, chunks, speaker);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const openaiStream = await getOpenAI().chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Напиши сценарий на тему: «${topic}»` },
            ],
            stream: true,
            temperature: 0.8,
            max_tokens: 4000,
          });

          for await (const chunk of openaiStream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`)
              );
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Generate stream error:", err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Ошибка генерации сценария" })}\n\n`
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
    console.error("Generate error:", error);
    const message =
      error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
