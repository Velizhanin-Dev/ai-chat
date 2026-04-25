#!/usr/bin/env node
/**
 * Извлекает текст из PDF и записывает в src/lib/knowledge-base.ts
 *
 * Использование:
 *   node scripts/pdf-to-knowledge.mjs <путь_к_pdf>
 *
 * Пример:
 *   node scripts/pdf-to-knowledge.mjs book.pdf
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const [, , filePath] = process.argv;

if (!filePath) {
  console.error("Использование: node scripts/pdf-to-knowledge.mjs <файл.pdf>");
  process.exit(1);
}

const absPath = resolve(process.cwd(), filePath);

async function main() {
  console.log(`Читаем PDF: ${absPath}\n`);

  const buffer = readFileSync(absPath);
  const data = await pdfParse(buffer);

  console.log(`Страниц: ${data.numpages}`);
  console.log(`Символов (raw): ${data.text.length.toLocaleString()}`);

  // Чистка текста
  let text = data.text;

  // 1. Заменяем неразрывные пробелы (U+00A0) и другие unicode-пробелы на обычные
  text = text.replace(/[\u00A0\u2009\u200A\u202F\u205F]/g, " ");

  // 2. Убираем пробелы в конце и начале каждой строки (до склейки переносов)
  text = text.replace(/[ \t]+$/gm, "");
  text = text.replace(/^[ \t]+/gm, "");

  // 2. Склеиваем переносы слов (кириллица + латиница)
  const L = "[а-яёА-ЯЁa-zA-Z]";
  //    Вариант А: "сло-\nво" — дефис в конце строки
  text = text.replace(new RegExp(`(${L})-\\n(${L})`, "g"), "$1$2");
  //    Вариант Б: "сло\n-\nво" — дефис на отдельной строке
  text = text.replace(new RegExp(`(${L})\\n-\\n(${L})`, "g"), "$1$2");

  // 3. Убираем оглавление: строки с 4+ точками подряд (.......)
  text = text.replace(/^.+\.{4,}.*\d*\s*$/gm, "");

  // 4. Убираем строки с только цифрами (номера страниц)
  text = text.replace(/^\d+\s*$/gm, "");

  // 5. Убираем лишние пробелы внутри строк (PDF часто вставляет двойные/тройные)
  text = text.replace(/[ \t]{2,}/g, " ");
  // "бизнес- инструмент" → "бизнес-инструмент" (пробел после дефиса не в переносе)
  text = text.replace(/([а-яёА-ЯЁa-zA-Z])- ([а-яёА-ЯЁa-zA-Z])/g, "$1-$2");

  // 6. Убираем множественные пустые строки (3+ → 2)
  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.trim();

  console.log(`Символов (clean): ${text.length.toLocaleString()}\n`);

  // Экранируем бэктики и ${} для template literal
  const escaped = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  const output = `/**
 * Полная база знаний — загружается в system prompt целиком.
 * Prompt caching (cache_control: "ephemeral") кэширует этот текст
 * на стороне Claude — повторные запросы стоят ~10% от первого.
 *
 * Сгенерировано из: ${filePath}
 * Дата: ${new Date().toISOString().split("T")[0]}
 */
export const KNOWLEDGE_BASE = \`${escaped}\`;
`;

  const outPath = resolve(process.cwd(), "src/lib/knowledge-base.ts");
  writeFileSync(outPath, output, "utf-8");

  console.log(`Записано в: src/lib/knowledge-base.ts`);
  console.log(`Размер файла: ${(Buffer.byteLength(output) / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
