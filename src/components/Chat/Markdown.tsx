"use client";

import { TypographyStylesProvider } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Рендер markdown из ответа нейронки в нормальную типографику (без «**» и «#» в тексте).
// TypographyStylesProvider даёт Mantine-стили для h1–h6, списков, code, таблиц и т.д.
// Ссылки открываем в новой вкладке. Класс md-body поджимает внешние отступы внутри
// баббла (см. globals.css).
export default function Markdown({ content }: { content: string }) {
  return (
    <TypographyStylesProvider className="md-body">
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
