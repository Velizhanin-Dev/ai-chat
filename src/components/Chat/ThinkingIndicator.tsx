"use client";

import { useEffect, useState } from "react";
import { Text } from "@mantine/core";
import { IconFileTextSpark, IconWorldSearch } from "@tabler/icons-react";
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

// Своя цепочка на время разбора ролика по ссылке: расшифровку тянет внешний
// сервис, это заметные секунды до первого токена. Молчать про это нельзя ровно по
// той же причине, что и про веб-поиск.
const VIDEO_PHRASES = [
  "разбираю видео",
  "читаю расшифровку",
  "смотрю, как построен заход",
  "собираю мысли",
  "пишу ответ",
];

const STEP_MS = 1900;

export default function ThinkingIndicator() {
  const isSearching = useAppSelector((s) => s.chat.isSearching);
  const isAnalyzingVideo = useAppSelector((s) => s.chat.isAnalyzingVideo);
  const [i, setI] = useState(0);

  // Разбор ролика важнее показать, чем поиск: он дольше и человек только что сам
  // прислал ссылку — ждёт реакции именно на неё.
  const mode = isAnalyzingVideo ? "video" : isSearching ? "search" : "think";
  const phrases =
    mode === "video" ? VIDEO_PHRASES : mode === "search" ? SEARCH_PHRASES : PHRASES;

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
    if (isSearching || isAnalyzingVideo) setI(0);
  }, [isSearching, isAnalyzingVideo]);

  return (
    <Text
      component="span"
      size="sm"
      fs="italic"
      aria-label={
        mode === "video"
          ? "Разбираю видео"
          : mode === "search"
            ? "Ищу в интернете"
            : "Готовлю ответ"
      }
    >
      {mode === "video" && (
        <IconFileTextSpark size={15} stroke={1.6} className="thinking-globe" aria-hidden />
      )}
      {mode === "search" && (
        <IconWorldSearch
          size={15}
          stroke={1.6}
          className="thinking-globe"
          aria-hidden
        />
      )}
      {/* key={i} — ремоунт спана на смене фразы, чтобы проиграть fade-in. */}
      <span key={`${mode}-${i}`} className="thinking-phrase">
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
