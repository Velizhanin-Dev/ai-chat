#!/usr/bin/env node
/**
 * Загрузка файла в базу знаний напрямую, минуя HTTP API.
 *
 * Использование:
 *   node scripts/ingest-file.mjs <путь_к_файлу> [спикер]
 *
 * Примеры:
 *   node scripts/ingest-file.mjs book.pdf "Николай Велижанин"
 *   node scripts/ingest-file.mjs notes.txt
 */

import { readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { createRequire } from "module";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env") });

const require = createRequire(import.meta.url);

// ── args ──────────────────────────────────────────────────────────────────────
const [, , filePath, speaker = ""] = process.argv;

if (!filePath) {
  console.error("Использование: node scripts/ingest-file.mjs <файл> [спикер]");
  process.exit(1);
}

const absPath = resolve(process.cwd(), filePath);

if (!existsSync(absPath)) {
  console.error(`Файл не найден: ${absPath}`);
  process.exit(1);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push({ text: chunk, index: index++ });
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

function progress(current, total, label = "") {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round(pct / 2);
  const bar = "█".repeat(filled) + "░".repeat(50 - filled);
  process.stdout.write(`\r[${bar}] ${pct}% ${label}    `);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const source = basename(absPath);
  console.log(`\nФайл:    ${source}`);
  console.log(`Спикер:  ${speaker || "(не задан)"}\n`);

  // 1. Читаем файл
  process.stdout.write("Читаем файл... ");
  let text = "";
  if (absPath.endsWith(".pdf")) {
    const pdfParse = require("pdf-parse");
    const buffer = readFileSync(absPath);
    const data = await pdfParse(buffer);
    text = data.text;
  } else {
    text = readFileSync(absPath, "utf-8");
  }
  console.log(`${text.length.toLocaleString()} символов`);

  // 2. Нарезаем на чанки
  const chunks = chunkText(text);
  console.log(`Чанков:  ${chunks.length}\n`);

  // 3. Эмбеддинги через OpenAI
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const EMBEDDING_MODEL = "text-embedding-3-large";
  const EMBEDDING_DIMENSIONS = 1024;
  const BATCH_SIZE = 20;

  const allEmbeddings = [];
  console.log("Создаём эмбеддинги:");

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((c) => c.text),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    allEmbeddings.push(...response.data.map((d) => d.embedding));
    progress(Math.min(i + BATCH_SIZE, chunks.length), chunks.length);
  }
  console.log("\n");

  // 4. Upsert в Pinecone
  const { Pinecone } = await import("@pinecone-database/pinecone");
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX);

  const { v4: uuidv4 } = require("uuid");
  const pineconeIds = chunks.map(() => uuidv4());

  const vectors = chunks.map((chunk, i) => ({
    id: pineconeIds[i],
    values: allEmbeddings[i],
    metadata: {
      text: chunk.text,
      source,
      speaker,
      createdAt: new Date().toISOString(),
    },
  }));

  const UPSERT_BATCH = 100;
  console.log("Загружаем в Pinecone:");
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await index.upsert(vectors.slice(i, i + UPSERT_BATCH));
    progress(Math.min(i + UPSERT_BATCH, vectors.length), vectors.length);
  }
  console.log("\n");

  // 5. Сохраняем в PostgreSQL
  process.stdout.write("Сохраняем в PostgreSQL... ");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  await prisma.document.create({
    data: {
      source,
      speaker: speaker || null,
      chunks: {
        create: chunks.map((chunk, i) => ({
          text: chunk.text,
          pineconeId: pineconeIds[i],
        })),
      },
    },
  });

  await prisma.$disconnect();
  console.log("готово\n");

  console.log("✓ Готово!");
  console.log(`  Документ: ${source}`);
  console.log(`  Чанков загружено: ${chunks.length}`);
}

main().catch((err) => {
  console.error("\nОшибка:", err.message);
  process.exit(1);
});
