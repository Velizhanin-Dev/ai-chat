#!/usr/bin/env node
/**
 * Извлекает текст из экспорта Telegram Desktop (result.json)
 * и выводит каждый пост как абзац.
 *
 * Использование:
 *   node scripts/tg-export-to-text.mjs <путь_к_result.json>
 *
 * Пример:
 *   node scripts/tg-export-to-text.mjs ~/Downloads/result.json
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const [, , filePath] = process.argv;

if (!filePath) {
  console.error("Использование: node scripts/tg-export-to-text.mjs <result.json>");
  process.exit(1);
}

const absPath = resolve(process.cwd(), filePath);
const data = JSON.parse(readFileSync(absPath, "utf-8"));

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

const messages = data.messages ?? [];

const posts = messages
  .filter((msg) => msg.type === "message")
  .map((msg) => extractText(msg.text))
  .filter((text) => text.length > 0);

console.log(`Всего сообщений: ${messages.length}`);
console.log(`Текстовых постов: ${posts.length}`);
console.log(`\n${"─".repeat(60)}\n`);

const combined = posts.join("\n\n");

console.log(combined);

// Также сохраняем в файл рядом со скриптом
const outPath = resolve(process.cwd(), "scripts/tg-posts-raw.txt");
writeFileSync(outPath, combined, "utf-8");
console.log(`\n${"─".repeat(60)}`);
console.log(`Сохранено в: scripts/tg-posts-raw.txt`);
console.log(`Символов: ${combined.length.toLocaleString()}`);
