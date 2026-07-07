"use client";

import { useEffect, useState } from "react";
import { Text } from "@mantine/core";

// Индикатор «думает» до первого токена. TTFT у нас долгий (не из-за размера
// контекста), поэтому вместо статичного «печатает» прокручиваем живые статусы в
// голосе Велижанина: врубается → думает → пишет. Дойдя до последнего — держимся
// на нём (не зацикливаем в начало, иначе кажется, будто он снова «врубается»).
// Текст с бренд-шиммером + пульсирующие точки; всё гасится при reduced-motion.
const PHRASES = [
  "врубаюсь в вопрос",
  "прикидываю, как лучше зайти",
  "собираю мысли",
  "накидываю структуру",
  "пишу ответ",
];

const STEP_MS = 1900;

export default function ThinkingIndicator() {
  const [i, setI] = useState(0);

  // Цепочка setTimeout по индексу: шагаем вперёд и останавливаемся на последней
  // фразе (без интервала, который бы крутился вхолостую после остановки).
  useEffect(() => {
    if (i >= PHRASES.length - 1) return;
    const id = setTimeout(() => setI(i + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [i]);

  return (
    <Text component="span" size="sm" fs="italic" aria-label="Готовлю ответ">
      {/* key={i} — ремоунт спана на смене фразы, чтобы проиграть fade-in. */}
      <span key={i} className="thinking-phrase">
        {PHRASES[i]}
      </span>
      <span className="thinking-dots" aria-hidden>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </Text>
  );
}
