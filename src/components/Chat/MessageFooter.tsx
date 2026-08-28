"use client";

import { useState } from "react";
import { IconCopy, IconCheck, IconFileText, IconDownload, IconLink } from "@tabler/icons-react";
import {
  extractScenario,
  looksLikeScenario,
  scenarioFileName,
} from "@/lib/scenario-extract";
import { extractSources } from "@/lib/chat-sources";

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
  const [copiedClean, setCopiedClean] = useState(false);

  // Сценарий уносят из чата в работу — в Google Docs, суфлёр, монтажёру, — и там
  // живая речь ассистента вокруг артефакта только мешает. Поэтому у сценариев
  // (и только у них) есть отдельные кнопки: чистый текст и файл.
  const isScenario = looksLikeScenario(content);

  // Ссылки собираем в сноски внизу ответа: модель с включённым веб-поиском
  // ставит их после каждого второго предложения, причём одну и ту же по пять раз
  // (см. chat-sources.ts). Из тела «сносочные» ссылки уже вырезаны родителем.
  const sources = extractSources(content);

  // ⚠️ В буфер уходит текст ВМЕСТЕ со списком источников: на экране они вынесены
  // вниз отдельным блоком, и без них скопированный ответ терял бы все ссылки.
  const copyText = (): string => {
    if (sources.length === 0) return content;
    const list = sources.map((s) => `- ${s.label}: ${s.url}`).join("\n");
    return `${content}\n\nИсточники:\n${list}`;
  };

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(copyText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен (не-secure контекст) — молча игнорируем */
    }
  };

  const copyClean = async () => {
    try {
      await navigator.clipboard.writeText(extractScenario(content));
      setCopiedClean(true);
      setTimeout(() => setCopiedClean(false), 1500);
    } catch {
      /* см. выше */
    }
  };

  // Файл собираем на лету: .txt с чистым сценарием. Blob + временная ссылка —
  // без похода на сервер, файл не нужно нигде хранить.
  const download = () => {
    const blob = new Blob([extractScenario(content)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = scenarioFileName(content);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Освобождаем URL — иначе blob висит в памяти вкладки до перезагрузки.
    URL.revokeObjectURL(url);
  };

  const stamp = formatStamp(createdAt);

  return (
    <>
      {sources.length > 0 && (
        <div className="msg-sources">
          <span className="msg-sources-title">
            <IconLink size={13} /> Источники
          </span>
          <ol className="msg-sources-list">
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="msg-foot">
      <span className="msg-foot-time">{stamp}</span>
      <span className="msg-foot-actions">
        {isScenario && (
          <>
            <button
              type="button"
              className="msg-foot-copy"
              onClick={copyClean}
              aria-label={copiedClean ? "Скопировано" : "Скопировать только сценарий"}
              title="Только текст сценария, без комментариев"
            >
              {copiedClean ? <IconCheck size={14} /> : <IconFileText size={14} />}
              <span>{copiedClean ? "Скопировано" : "Только сценарий"}</span>
            </button>
            <button
              type="button"
              className="msg-foot-copy"
              onClick={download}
              aria-label="Скачать сценарий файлом"
              title="Скачать .txt без комментариев"
            >
              <IconDownload size={14} />
              <span>Файл</span>
            </button>
          </>
        )}
        <button
          type="button"
          className="msg-foot-copy"
          onClick={copyRaw}
          aria-label={copied ? "Скопировано" : "Скопировать ответ"}
          title={copied ? "Скопировано" : "Скопировать ответ целиком"}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          <span>{copied ? "Скопировано" : "Копировать"}</span>
        </button>
      </span>
      </div>
    </>
  );
}
