"use client";

import { TypographyStylesProvider } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Рендер markdown из ответа нейронки в нормальную типографику (без «**» и «#» в тексте).
// TypographyStylesProvider даёт Mantine-стили для h1–h6, списков, code, таблиц и т.д.
// Ссылки открываем в новой вкладке. Класс md-body поджимает внешние отступы внутри
// баббла (см. globals.css).
// streaming=true вешает класс md-streaming → мигающая каретка в конце текста
// (см. globals.css). Включаем только на «живом» (печатаемом) баббле.
export default function Markdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <TypographyStylesProvider
      className={streaming ? "md-body md-streaming" : "md-body"}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </TypographyStylesProvider>
  );
}
