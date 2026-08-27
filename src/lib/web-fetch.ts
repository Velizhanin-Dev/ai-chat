// ── Чтение произвольных страниц («изучи сайт N») ─────────────────────────────
//
// Зачем: ассистент работает вслепую по отношению к тому, что человек реально
// продаёт. Ниша в брифе — одна строка, а на лендинге лежит всё: оффер, цены,
// характеристики, обещания, возражения в блоке FAQ и лексика, которой сам клиент
// описывает продукт. Отсюда и «средние по интернету» идеи: моделью подставляется
// самое вероятное, а не то, что есть у клиента.
//
// ⚠️ Ходим через ТОТ ЖЕ зарубежный микросервис, что и за расшифровками
// (эндпоинт /fetch): прод стоит в РФ, часть сайтов оттуда недоступна, плюс на
// сервисе живёт защита от SSRF (резолв DNS, запрет приватных адресов, ручная
// обработка редиректов). Переменная не задана — идём напрямую, это режим
// локальной разработки.
//
// ⚠️ Разбор HTML — ЗДЕСЬ, а не в сервисе: там же, где парсеры YouTube. Две
// реализации на разных языках неизбежно разъедутся (та же причина, по которой
// субтитры отдаются сырым WebVTT).

import { prisma } from "./prisma";

const SERVICE_BASE = (() => {
  const explicit = (process.env.YT_SCRAPE_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  const transcript = (process.env.YT_TRANSCRIPT_URL || "").replace(/\/$/, "");
  return transcript ? transcript.replace(/\/[^/]*$/, "") : "";
})();
const SERVICE_TOKEN = process.env.YT_TRANSCRIPT_TOKEN || "";
const TIMEOUT_MS = Math.max(5_000, Number(process.env.WEB_FETCH_TIMEOUT_MS ?? 25_000));

// Кэш страницы в БД. Лендинги и статьи меняются медленно, а сходить за страницей —
// это внешний запрос на пару мегабайт. Неделя: за это время оффер может обновиться,
// но не настолько, чтобы это меняло смысл контента.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Сколько текста страницы отдаём модели. Больше — вытесняет из промпта методику. */
export const PAGE_TEXT_LIMIT = 8000;

export interface PageContent {
  url: string;
  title: string;
  description: string;
  /** Очищенный основной текст страницы (уже обрезанный под промпт). */
  text: string;
  /** Заголовки h1–h3 по порядку: скелет страницы, по нему видно структуру оффера. */
  headings: string[];
}

export type PageResult =
  | { status: "ok"; page: PageContent }
  | { status: "empty" } // страница открылась, но текста в ней нет (SPA)
  | { status: "error"; reason: string };

/** Ссылка ли это вообще (для разбора сообщений в чате). */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Нормализация адреса для кэша: без хэша и utm-меток.
 *
 * ⚠️ Иначе одна и та же страница с разными метками из рекламы кэшируется по
 * десять раз, и каждый раз мы платим внешним запросом.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    const drop: string[] = [];
    u.searchParams.forEach((_, key) => {
      if (/^(utm_|yclid|gclid|fbclid|from|ref)/i.test(key)) drop.push(key);
    });
    for (const key of drop) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
}

// ── Извлечение текста ────────────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»");
}

function metaContent(html: string, name: string): string {
  // ⚠️ Порядок атрибутов в теге произвольный, поэтому две попытки: content после
  // имени и content до имени. Без флага /s — его не принимает target сборки.
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeEntities(m[1]).trim();
  }
  return "";
}

/**
 * Текст страницы без разметки.
 *
 * ⚠️ Никакого DOM и readability: тянуть jsdom ради этого — лишние мегабайты в
 * образ. Здесь достаточно грубой очистки, потому что дальше текст всё равно
 * читает модель, а не парсер: ей важны смысл и формулировки, а не идеальная
 * структура. Выкидываем то, что гарантированно шум: скрипты, стили, навигацию,
 * подвал, формы.
 */
export function extractPage(html: string, url: string): PageContent {
  const title =
    metaContent(html, "og:title") ||
    decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim());
  const description =
    metaContent(html, "description") || metaContent(html, "og:description");

  // Заголовки собираем ДО очистки: по ним видно скелет оффера («Кому подойдёт»,
  // «Сколько стоит», «Частые вопросы») — самое ценное на лендинге.
  const headings: string[] = [];
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(html)) !== null && headings.length < 40) {
    const text = decodeEntities(hm[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 2 && text.length <= 200) headings.push(text);
  }

  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Блочные теги превращаем в переводы строк, чтобы абзацы не слипались в кашу.
  body = body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n");
  const text = decodeEntities(body.replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, PAGE_TEXT_LIMIT);

  return { url, title, description, text, headings };
}

// ── Загрузка ─────────────────────────────────────────────────────────────────

async function download(url: string): Promise<{ html: string; reason?: string }> {
  try {
    if (SERVICE_BASE) {
      const res = await fetch(`${SERVICE_BASE}/fetch?url=${encodeURIComponent(url)}`, {
        headers: SERVICE_TOKEN ? { "X-Token": SERVICE_TOKEN } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { html: "", reason: `сервис ответил ${res.status}` };
      const data = (await res.json()) as { html?: string; reason?: string };
      return { html: data.html || "", reason: data.reason };
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru,en;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { html: "", reason: `сайт ответил ${res.status}` };
    return { html: await res.text() };
  } catch {
    return { html: "", reason: "страница не открылась" };
  }
}

/**
 * Страница по адресу: из кэша или живьём.
 *
 * ⚠️ Ошибку не глотаем, а возвращаем причину: «сайт не открылся, потому что…»
 * человеку полезнее молчания — та же логика, что с расшифровками роликов.
 */
export async function fetchPage(rawUrl: string, force = false): Promise<PageResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { status: "error", reason: "это не похоже на ссылку" };

  if (!force) {
    const cached = await prisma.pageSnapshot
      .findUnique({ where: { url } })
      .catch(() => null);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return {
        status: "ok",
        page: {
          url,
          title: cached.title,
          description: cached.description,
          text: cached.text,
          headings: (cached.headings as unknown as string[]) ?? [],
        },
      };
    }
  }

  const { html, reason } = await download(url);
  if (!html) return { status: "error", reason: reason ?? "страница не открылась" };

  const page = extractPage(html, url);
  // ⚠️ Мало текста — это почти всегда SPA: содержимое рисует JavaScript, а в HTML
  // пусто. Врать «всё хорошо» тут нельзя, иначе модель разберёт пустоту.
  if (page.text.length < 200) return { status: "empty" };

  await prisma.pageSnapshot
    .upsert({
      where: { url },
      create: {
        url,
        title: page.title,
        description: page.description,
        text: page.text,
        headings: page.headings as unknown as object,
      },
      update: {
        title: page.title,
        description: page.description,
        text: page.text,
        headings: page.headings as unknown as object,
        fetchedAt: new Date(),
      },
    })
    .catch((err) => console.error("[web-fetch] кэш страницы:", err));

  return { status: "ok", page };
}

/** Блок страницы для промпта. */
export function pagePromptBlock(page: PageContent): string {
  const parts = [
    `Страница: ${page.url}`,
    page.title ? `Заголовок: ${page.title}` : "",
    page.description ? `Описание: ${page.description}` : "",
    page.headings.length ? `Разделы страницы: ${page.headings.slice(0, 25).join(" · ")}` : "",
    "",
    "Текст страницы:",
    page.text,
  ];
  return parts.filter(Boolean).join("\n");
}
