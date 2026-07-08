"use client";

import { useRef, useState } from "react";
import { TypographyStylesProvider } from "@mantine/core";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Блок-цитата с кнопкой «копировать» в углу. Цитаты — это готовые к произнесению
// фразы (хук, реплика, текст на превью), их удобно копировать одним тапом. Текст
// берём из innerText отрендеренного блока (кнопка — SVG-иконка, в innerText не
// попадает). На hover/focus кнопка проявляется (стили .md-quote* в globals.css).
function Blockquote({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLQuoteElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = ref.current?.innerText?.trim() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен (не-secure контекст) — молча игнорируем */
    }
  };

  return (
    <blockquote ref={ref} className="md-quote">
      {children}
      <button
        type="button"
        className="md-quote-copy"
        onClick={copy}
        aria-label={copied ? "Скопировано" : "Скопировать цитату"}
        title={copied ? "Скопировано" : "Скопировать"}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </blockquote>
  );
}

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
          blockquote: ({ node, ...props }) => (
            <Blockquote>{props.children}</Blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </TypographyStylesProvider>
  );
}
