import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hydeSearch, streamRagResponse } from "@/lib/rag";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, sessionId } = body;

    if (!question?.trim()) {
      return new Response(
        JSON.stringify({ error: "Вопрос не может быть пустым" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId обязателен" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await prisma.chatMessage.create({
      data: {
        role: "user",
        content: question,
        sessionId,
      },
    });

    const { chunks, speaker } = await hydeSearch(question);

    const previousMessages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const history = previousMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const encoder = new TextEncoder();
    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of streamRagResponse(
            question,
            chunks,
            speaker,
            history
          )) {
            fullResponse += token;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
          }

          await prisma.chatMessage.create({
            data: {
              role: "assistant",
              content: fullResponse,
              sessionId,
            },
          });

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
