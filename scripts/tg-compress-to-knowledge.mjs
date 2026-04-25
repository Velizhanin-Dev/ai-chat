#!/usr/bin/env node
/**
 * Суммаризирует Telegram-посты через Claude и записывает в src/lib/knowledge-base-tg.ts
 *
 * Использование:
 *   node scripts/tg-compress-to-knowledge.mjs <путь_к_result.json>
 *
 * Пример:
 *   node scripts/tg-compress-to-knowledge.mjs "C:/Users/Artem/Downloads/result.json"
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import Anthropic from "@anthropic-ai/sdk";

const [, , filePath] = process.argv;

if (!filePath) {
  console.error("Использование: node scripts/tg-compress-to-knowledge.mjs <result.json>");
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Извлекает чистый текст из поля text (строка или массив сущностей).
 */
function extractText(text) {
  if (!text) return "";
  if (typeof text === "string") return text.trim();
  if (Array.isArray(text)) {
    return text
      .map((part) => (typeof part === "string" ? part : part.text ?? ""))
      .join("")
      .trim();
  }
  return "";
}

/**
 * Форматирует дату: "2024-03-15T12:00:00" → "15.03.2024"
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/**
 * Разбивает массив постов на батчи по ~BATCH_CHARS символов
 */
const BATCH_CHARS = 60_000;

function splitIntoBatches(posts) {
  const batches = [];
  let current = [];
  let currentLen = 0;

  for (const post of posts) {
    if (currentLen + post.text.length > BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(post);
    currentLen += post.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Форматирует батч постов в текст для Claude
 */
function formatBatch(posts) {
  return posts
    .map((p) => `[${p.date}]\n${p.text}`)
    .join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `Ты помощник, который суммаризирует Telegram-посты автора для его базы знаний.

Твоя задача:
- Извлечь полезную информацию: советы, инсайты, факты, важные мысли, выводы
- Сохранить разговорную речь и стиль автора — как будто он сам это говорит
- Сохранять конкретные факты: имена, места, события, важные фразы
- Если пост привязан к конкретной дате (встреча, событие, разговор с кем-то) — сохраняй дату в формате [ДД.ММ.ГГГГ]
- Убирать посты без полезной информации: рекламу, пустые объявления, технические сообщения, розыгрыши, просьбы подписаться
- Группировать похожие мысли в абзацы

Пиши результат связным текстом, не нумерованным списком. Каждая мысль — отдельный абзац.`;

async function summarizeBatch(posts, batchIndex, totalBatches) {
  console.log(`  Отправляем батч ${batchIndex + 1}/${totalBatches} (${posts.length} постов)...`);

  const userMessage = `Вот Telegram-посты (формат [дата] текст):\n\n${formatBatch(posts)}\n\nСуммаризируй согласно инструкции.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "max_tokens") {
    console.warn(`  ⚠  Батч ${batchIndex + 1}: вывод обрезан по max_tokens — подними лимит или уменьши BATCH_CHARS`);
  }

  return response.content[0].text;
}

async function main() {
  const absPath = resolve(process.cwd(), filePath);
  console.log(`Читаем: ${absPath}\n`);

  const data = JSON.parse(readFileSync(absPath, "utf-8"));
  const messages = data.messages ?? [];

  // Извлекаем текстовые посты с датами
  const posts = messages
    .filter((msg) => msg.type === "message")
    .map((msg) => ({
      date: formatDate(msg.date),
      text: extractText(msg.text),
    }))
    .filter((p) => p.text.length > 30); // убираем совсем короткие (смайлы, "+" и т.п.)

  console.log(`Всего сообщений: ${messages.length}`);
  console.log(`Текстовых постов для обработки: ${posts.length}`);

  const batches = splitIntoBatches(posts);
  console.log(`Батчей: ${batches.length} (по ~${Math.round(BATCH_CHARS / 1000)}k символов)\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Ошибка: ANTHROPIC_API_KEY не задан");
    process.exit(1);
  }

  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const summary = await summarizeBatch(batches[i], i, batches.length);
    results.push(summary);
    console.log(`  ✓ Батч ${i + 1} готов (${summary.length.toLocaleString()} символов)`);
  }

  console.log(`\nОбъединяем результаты...`);

  let finalText = results.join("\n\n");

  // Если батчей было несколько — делаем финальную суммаризацию.
  // Стримим ответ, чтобы безопасно дождаться больших объёмов вывода.
  if (batches.length > 1) {
    console.log(`Финальная суммаризация (объединяем ${batches.length} батчей)...`);
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 32000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Вот уже суммаризированные части Telegram-постов. Объедини их в единый связный текст, убери повторы, сохрани все факты и даты:\n\n${finalText}`,
        },
      ],
    });
    const finalMessage = await stream.finalMessage();
    finalText = finalMessage.content[0].text;
    if (finalMessage.stop_reason === "max_tokens") {
      console.warn(`⚠  Финальная суммаризация обрезана по max_tokens — подними max_tokens или уменьши объём входа`);
    }
    console.log(`✓ Финальная суммаризация готова (stop_reason: ${finalMessage.stop_reason})`);
  }

  console.log(`\nИтого символов: ${finalText.length.toLocaleString()}`);

  // Экранируем для template literal
  const escaped = finalText
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  const output = `/**
 * База знаний из Telegram-постов — суммаризировано через Claude.
 * Prompt caching (cache_control: "ephemeral") кэширует этот текст на стороне Claude.
 *
 * Источник: ${filePath}
 * Дата генерации: ${new Date().toISOString().split("T")[0]}
 */
export const TELEGRAM_KNOWLEDGE = \`${escaped}\`;
`;

  const outPath = resolve(process.cwd(), "src/lib/knowledge-base-tg.ts");
  writeFileSync(outPath, output, "utf-8");

  console.log(`\nЗаписано в: src/lib/knowledge-base-tg.ts`);
  console.log(`Размер файла: ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
