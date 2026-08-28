"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";

// Кнопка «копировать» на СВОЁМ сообщении.
//
// Зачем: длинную вводную с деталями проекта («ниша такая-то, аудитория такая-то,
// сделай…») человек переиспользует в следующем проекте, а выделить её мышкой в
// скроллящейся ленте так же неудобно, как и ответ ассистента — из-за чего и
// появилась «борода» под ответами.
//
// ⚠️ Полноценную «бороду» сюда ставить нельзя: баббл юзера имеет ширину по
// контенту (fit-content), и полоса с временем и подписью растянула бы короткое
// «привет» на пол-экрана. Поэтому — иконка в углу, как у блок-цитат
// (.md-quote-copy): на hover/focus проявляется, на тач-экранах видна всегда.
export default function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен (не-secure контекст) — молча игнорируем */
    }
  };

  return (
    <button
      type="button"
      className="msg-user-copy"
      onClick={copy}
      aria-label={copied ? "Скопировано" : "Скопировать сообщение"}
      title={copied ? "Скопировано" : "Скопировать сообщение"}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}
