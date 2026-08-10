"use client";

import { useEffect, useState } from "react";
import { Text } from "@mantine/core";
import { IconWorldSearch } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";

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

// Своя цепочка на время веб-поиска: он сам по себе добавляет секунды к TTFT, и
// молчать про это нельзя — иначе выглядит как «завис». Первая фраза встаёт сразу,
// как только сервер прислал `searching` (до первого токена модели).
const SEARCH_PHRASES = [
  "ищу в интернете",
  "смотрю, что пишут",
  "сверяю фактуру",
  "собираю мысли",
  "пишу ответ",
];

const STEP_MS = 1900;

export default function ThinkingIndicator() {
  const isSearching = useAppSelector((s) => s.chat.isSearching);
  const [i, setI] = useState(0);

  const phrases = isSearching ? SEARCH_PHRASES : PHRASES;

  // Цепочка setTimeout по индексу: шагаем вперёд и останавливаемся на последней
  // фразе (без интервала, который бы крутился вхолостую после остановки).
  useEffect(() => {
    if (i >= phrases.length - 1) return;
    const id = setTimeout(() => setI(i + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [i, phrases.length]);

  // Сигнал о поиске приходит отдельным SSE-событием — возможно, когда цепочка уже
  // шагнула вперёд. Возвращаемся в начало, чтобы «ищу в интернете» реально
  // показалось, а не проскочило мимо на третьей фразе.
  useEffect(() => {
    if (isSearching) setI(0);
  }, [isSearching]);

  return (
    <Text
      component="span"
      size="sm"
      fs="italic"
      aria-label={isSearching ? "Ищу в интернете" : "Готовлю ответ"}
    >
      {isSearching && (
        <IconWorldSearch
          size={15}
          stroke={1.6}
          className="thinking-globe"
          aria-hidden
        />
      )}
      {/* key={i} — ремоунт спана на смене фразы, чтобы проиграть fade-in. */}
      <span key={`${isSearching ? "w" : "t"}-${i}`} className="thinking-phrase">
        {phrases[i]}
      </span>
      <span className="thinking-dots" aria-hidden>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </Text>
  );
}
