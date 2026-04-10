import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chunkText } from "@/lib/chunker";
import { createEmbeddingBatch } from "@/lib/openai";
import { upsertVectors } from "@/lib/pinecone";
import { v4 as uuidv4 } from "uuid";
import pdfParse from "pdf-parse";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let text = "";
    let source = "manual-input";
    let speaker = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const rawText = formData.get("text") as string | null;
      speaker = (formData.get("speaker") as string) || "";

      if (file) {
        source = file.name;
        const buffer = Buffer.from(await file.arrayBuffer());

        if (file.name.endsWith(".pdf")) {
          const pdfData = await pdfParse(buffer);
          text = pdfData.text;
        } else {
          text = buffer.toString("utf-8");
        }
      } else if (rawText) {
        text = rawText;
      }
    } else {
      const body = await request.json();
      text = body.text || "";
      source = body.source || "manual-input";
      speaker = body.speaker || "";
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Текст не может быть пустым" },
        { status: 400 }
      );
    }

    const chunks = chunkText(text);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "Не удалось разбить текст на чанки" },
        { status: 400 }
      );
    }

    const batchSize = 20;
    const allVectors: {
      id: string;
      values: number[];
      metadata: Record<string, string>;
    }[] = [];
    const chunkIds: string[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);
      const embeddings = await createEmbeddingBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const pineconeId = uuidv4();
        chunkIds.push(pineconeId);
        allVectors.push({
          id: pineconeId,
          values: embeddings[j],
          metadata: {
            text: batch[j].text,
            source,
            speaker,
            createdAt: new Date().toISOString(),
          },
        });
      }
    }

    await upsertVectors(allVectors);

    const document = await prisma.document.create({
      data: {
        source,
        speaker: speaker || null,
        chunks: {
          create: chunks.map((chunk, idx) => ({
            text: chunk.text,
            pineconeId: chunkIds[idx],
          })),
        },
      },
      include: { chunks: true },
    });

    return NextResponse.json({
      success: true,
      documentId: document.id,
      source: document.source,
      speaker: document.speaker,
      chunksCount: document.chunks.length,
      createdAt: document.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Ingest error:", error);
    const message =
      error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
