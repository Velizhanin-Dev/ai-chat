// ── Ссылки на сайты в сообщении чата ─────────────────────────────────────────
//
// Чистый модуль (клиент/сервер): только разбор текста, без сети.
//
// Зачем: человек кидает в чат ссылку на сайт клиента, лендинг объекта или статью
// и говорит «изучи». Раньше ассистент такие ссылки не открывал вовсе, и вся
// фактура о продукте (оффер, характеристики, цены, формулировки) оставалась за
// бортом — отсюда и продающий контент, придуманный из воздуха.
//
// ⚠️ Ролики YouTube тут НЕ обрабатываются: у них свой путь (расшифровка через
// микросервис, см. chat-video.ts). Если пропустить их сюда, мы будем читать
// HTML страницы ролика вместо его текста — то есть заметно хуже.

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

// Домены, которые разбираются отдельным механизмом или бесполезны как страница.
const SKIP_HOSTS = [
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "www.youtube.com",
  "music.youtube.com",
];

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Ссылки на обычные страницы из текста сообщения, по порядку, без повторов.
 *
 * ⚠️ Потолок обязателен: каждая страница — внешний запрос на пару мегабайт плюс
 * место в контексте. Человек, вставивший десять ссылок, иначе подвесит свой же
 * ответ и вытеснит из промпта методику.
 */
export function extractWebUrls(text: string, limit = 2): string[] {
  const out: string[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    // Хвостовая пунктуация прилипает к ссылке, когда её пишут в предложении.
    const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
    const host = hostOf(raw);
    if (!host) continue;
    if (SKIP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (out.includes(raw)) continue;
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

/** Есть ли в сообщении ссылка на обычный сайт. */
export function hasWebLink(text: string): boolean {
  return extractWebUrls(text, 1).length > 0;
}
