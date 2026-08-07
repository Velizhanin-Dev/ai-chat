"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";

// «Борода» под ответом ассистента: дата слева, кнопка «Копировать» справа.
//
// Зачем: выделить мышкой длинный сценарий целиком в скроллящейся ленте почти
// невозможно — на этом и споткнулись пользователи. Кнопка копирует ВЕСЬ ответ
// одним кликом.
//
// Копируем ИСХОДНЫЙ markdown, а не отрисованный текст: он лосслесс (заголовки,
// жирный, списки переживут вставку в Notion/редактор) и совпадает с тем, что
// реально сгенерила модель. Маркер [[connect_youtube]] родитель уже вырезал.
//
// Полоса прижата к краям баббла (отрицательные margin гасят padding Paper) —
// отсюда «без отступов» в ТЗ. Разделительная линия сверху отбивает её от текста.

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `${date}, ${time}`;
}

export default function MessageFooter({
  content,
  createdAt,
}: {
  content: string;
  createdAt: string;
}) {
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

  const stamp = formatStamp(createdAt);

  return (
    <div className="msg-foot">
      <span className="msg-foot-time">{stamp}</span>
      <button
        type="button"
        className="msg-foot-copy"
        onClick={copy}
        aria-label={copied ? "Скопировано" : "Скопировать ответ"}
        title={copied ? "Скопировано" : "Скопировать ответ целиком"}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        <span>{copied ? "Скопировано" : "Копировать"}</span>
      </button>
    </div>
  );
}
