/**
 * Поиск по книге (KNOWLEDGE_BASE) для подгрузки релевантных кусков вместо всей
 * книги в каждый запрос. См. docs/context-cost-plan.md (Фаза 2).
 *
 * Подход: книга режется на чанки по главам + группировке строк (~500 токенов),
 * каждый чанк тегируется главой. Поиск — BM25 по ключевым словам (без внешнего
 * embeddings-провайдера). Точные термины (ВИСП, удержание, превью) ловятся отлично,
 * что и нужно под цель «отвечать дословно формулировками из книги».
 *
 * Семантический (embeddings) слой — опциональный апгрейд: требует провайдера
 * (Voyage AI / OpenAI) и pgvector. Для дословного воспроизведения keyword-поиска
 * обычно достаточно.
 */
import { KNOWLEDGE_BASE } from "./knowledge-base";
import { VIDEO_FORMATS } from "./knowledge-base-formats";
import { TELEGRAM_KNOWLEDGE_CLOSED } from "./knowledge-base-tg-closed";
import { TELEGRAM_KNOWLEDGE } from "./knowledge-base-tg-open";

interface Chunk {
  chapter: string;
  text: string;
  /** Нормализованные термы чанка с частотами — считаем один раз при старте. */
  tf: Map<string, number>;
  len: number;
}

// Примерно символов на чанк. Кириллица ~3 символа/токен → ~500 токенов на чанк.
const CHUNK_CHARS = 1500;
const CHUNK_OVERLAP_LINES = 2;

const STOPWORDS = new Set(
  (
    "и в во не что он на я с со как а то все она так его но да ты к у же вы за бы " +
    "по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг " +
    "ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя " +
    "ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без " +
    "будто чего раз тоже себе под будет ж кто этот того потому этого какой совсем ним " +
    "здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно " +
    "при наконец два об другой хоть после над больше тот через эти нас про всего них " +
    "какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть " +
    "том нельзя такой им более всегда конечно всю между это эта эти весь"
  ).split(/\s+/)
);

/** Нормализация в термы: нижний регистр, ё→е, слова из букв длиной ≥3, без стоп-слов. */
function tokenize(s: string): string[] {
  const out: string[] = [];
  const matches = s.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z0-9]+/g);
  if (!matches) return out;
  for (const w of matches) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

function termFreq(terms: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Разбить текст одной главы на чанки по группам строк с небольшим перехлёстом. */
function chunkChapterBody(body: string): string[] {
  const lines = body.split("\n");
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    buf.push(line);
    bufLen += line.length + 1;
    if (bufLen >= CHUNK_CHARS) {
      chunks.push(buf.join("\n").trim());
      // перехлёст: оставляем хвост последних строк, чтобы не резать примеры
      buf = buf.slice(-CHUNK_OVERLAP_LINES);
      bufLen = buf.reduce((a, l) => a + l.length + 1, 0);
    }
  }
  const tail = buf.join("\n").trim();
  if (tail.length > 0) chunks.push(tail);
  return chunks.filter((c) => c.length > 0);
}

/** Разобрать книгу на главы по маркерам «ГЛАВА N» (берём тело после оглавления). */
function buildChunks(): Chunk[] {
  const text = KNOWLEDGE_BASE;
  // Маркеры глав в теле. Первые ~12 совпадений — оглавление; реальные главы идут
  // после «Введение». Делим по всем «ГЛАВА N» и группируем по последнему вхождению.
  const lines = text.split("\n");
  // Индексы строк, начинающихся с «ГЛАВА N»
  const headIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^ГЛАВА\s+\d+\s*$/.test(lines[i].trim())) headIdx.push(i);
  }
  // В оглавлении главы идут подряд (мало строк между ними); тело — там, где между
  // соседними маркерами много контента. Берём вторую половину вхождений как тело.
  // Надёжнее: тело начинается с ПОСЛЕДНЕГО блока, где после маркера >5 строк.
  const bodyHeads = headIdx.filter((idx, k) => {
    const next = headIdx[k + 1] ?? lines.length;
    return next - idx > 5; // в оглавлении расстояние маленькое
  });
  const chunks: Chunk[] = [];
  const heads = bodyHeads.length ? bodyHeads : headIdx;
  for (let k = 0; k < heads.length; k++) {
    const start = heads[k];
    const end = heads[k + 1] ?? lines.length;
    const num = lines[start].trim();
    // заголовок главы — ближайшие непустые строки после маркера
    let titleEnd = start + 1;
    const titleParts: string[] = [];
    while (titleEnd < end && titleParts.length < 3) {
      const l = lines[titleEnd].trim();
      titleEnd++;
      if (l) titleParts.push(l);
      else if (titleParts.length) break;
    }
    const chapter = `${num} — ${titleParts.join(" ")}`.trim();
    const body = lines.slice(titleEnd, end).join("\n");
    for (const piece of chunkChapterBody(body)) {
      const terms = tokenize(piece);
      if (terms.length === 0) continue;
      chunks.push({ chapter, text: piece, tf: termFreq(terms), len: terms.length });
    }
  }
  return chunks;
}

// Индекс строится один раз на инстанс.
const CHUNKS: Chunk[] = buildChunks();
const N = CHUNKS.length;
const AVGDL = N ? CHUNKS.reduce((a, c) => a + c.len, 0) / N : 0;
const DF: Map<string, number> = (() => {
  const df = new Map<string, number>();
  for (const c of CHUNKS) {
    c.tf.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1));
  }
  return df;
})();

const K1 = 1.5;
const B = 0.75;

function idf(term: string): number {
  const df = DF.get(term) ?? 0;
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

export interface BookHit {
  chapter: string;
  text: string;
  score: number;
}

/** BM25-поиск по книге. Возвращает top-k релевантных кусков. */
export function searchBook(query: string, k = 10): BookHit[] {
  const qTerms = Array.from(new Set(tokenize(query)));
  if (qTerms.length === 0 || N === 0) return [];
  const scored = CHUNKS.map((c) => {
    let score = 0;
    for (const t of qTerms) {
      const tf = c.tf.get(t);
      if (!tf) continue;
      const denom = tf + K1 * (1 - B + (B * c.len) / AVGDL);
      score += idf(t) * ((tf * (K1 + 1)) / denom);
    }
    return { chapter: c.chapter, text: c.text, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Собрать system-блок из найденных кусков с обрамлением «копируй дословно».
 * Пустая строка — если ничего не нашли (тогда блок не добавляем).
 */
export function buildBookContextBlock(query: string, k = 10): string {
  const hits = searchBook(query, k);
  if (hits.length === 0) return "";
  const body = hits
    .map((h) => `[${h.chapter}]\n${h.text}`)
    .join("\n\n— — —\n\n");
  return (
    `# Выдержки из моей книги по теме запроса\n\n` +
    `Это мои реальные формулировки. Бери из них обороты, структуру и конкретику ДОСЛОВНО — ` +
    `копируй форму, а не пересказывай своими словами. Если нужного в выдержках нет — ` +
    `скажи прямо, не выдумывай.\n\n` +
    body
  );
}

/** Диагностика: сколько чанков построено (для логов). */
export function bookChunkCount(): number {
  return N;
}

// ── Библиотека форматов: точечный выбор формата вместо загрузки всех 12 ─────────

interface FormatEntry {
  title: string;
  triggers: Set<string>;
  tf: Map<string, number>;
  text: string;
}

/** Разобрать VIDEO_FORMATS на шапку (правила) + 12 форматов по маркеру «## Формат». */
function buildFormats(): { header: string; entries: FormatEntry[] } {
  const parts = VIDEO_FORMATS.split(/\n## Формат /);
  const header = (parts[0] ?? "").trim();
  const entries: FormatEntry[] = [];
  for (let i = 1; i < parts.length; i++) {
    const text = `## Формат ${parts[i].trim()}`;
    const title = text.split("\n")[0];
    const trig = text.match(/Триггеры:\s*(.+)/);
    const triggers = new Set(trig ? tokenize(trig[1]) : []);
    entries.push({ title, triggers, tf: termFreq(tokenize(text)), text });
  }
  return { header, entries };
}

const FORMATS = buildFormats();

/**
 * Выбрать 1–2 формата под запрос вместо всех 12. Совпадение с «Триггеры:» весит
 * сильно — это сигнал, под который форматы и сделаны. Шапка с правилами добавляется
 * всегда. Если ничего не подошло — отдаём всю библиотеку (безопасный фолбэк).
 * Контент детерминирован (фикс. тексты) → кэшируется по выбранному набору.
 */
export function selectFormatsBlock(query: string, k = 2): string {
  const q = Array.from(new Set(tokenize(query)));
  if (q.length === 0) return VIDEO_FORMATS;
  const scored = FORMATS.entries
    .map((e) => {
      let s = 0;
      for (const t of q) {
        if (e.triggers.has(t)) s += 5;
        else if (e.tf.has(t)) s += 1;
      }
      return { e, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
  if (scored.length === 0) return VIDEO_FORMATS;
  const body = scored.map((x) => x.e.text).join("\n\n---\n\n");
  return `${FORMATS.header}\n\n---\n\n${body}`;
}

// ── Telegram: ретрив релевантных секций вместо загрузки всего канала ─────────────
//
// Канал целиком ~37k токенов: на холодном входе Opus это ~$0.18 (без кэша) или
// ~$0.37 (запись 1ч-кэша) — а при редком трафике кэш не успевает окупиться. Поэтому
// под запрос достаём только релевантные секции (~10k токенов → ~$0.05), как у книги.
// Тот же BM25, чанк = секция по «## заголовку» (крупные дробим как главы книги).

interface TgChunk {
  section: string;
  text: string;
  tf: Map<string, number>;
  len: number;
}

/** Разбить канал на чанки: секции по «## заголовкам», крупные — дополнительно. */
function chunkTg(raw: string): TgChunk[] {
  const sections = raw.split(/\n(?=#{1,3}\s)/);
  const chunks: TgChunk[] = [];
  for (const sec of sections) {
    const section = (sec.match(/^#{1,3}\s*(.+)/)?.[1] ?? "").trim();
    for (const piece of chunkChapterBody(sec)) {
      const terms = tokenize(piece);
      if (terms.length === 0) continue;
      chunks.push({ section, text: piece, tf: termFreq(terms), len: terms.length });
    }
  }
  return chunks;
}

interface TgHit {
  chunk: TgChunk;
  score: number;
}

/** BM25-поиск поверх готового набора TG-чанков (свой индекс на канал). */
function makeTgSearch(chunks: TgChunk[]): (q: string, k: number) => TgHit[] {
  const n = chunks.length;
  const avgdl = n ? chunks.reduce((a, c) => a + c.len, 0) / n : 0;
  const df = new Map<string, number>();
  for (const c of chunks) c.tf.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1));
  const tgIdf = (t: string) => {
    const d = df.get(t) ?? 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };
  return (query, k) => {
    const qTerms = Array.from(new Set(tokenize(query)));
    if (qTerms.length === 0 || n === 0) return [];
    const scored = chunks.map((c) => {
      let score = 0;
      for (const t of qTerms) {
        const tf = c.tf.get(t);
        if (!tf) continue;
        const denom = tf + K1 * (1 - B + (B * c.len) / avgdl);
        score += tgIdf(t) * ((tf * (K1 + 1)) / denom);
      }
      return { chunk: c, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };
}

// Индексы строятся один раз на инстанс.
const TG_CLOSED_SEARCH = makeTgSearch(chunkTg(TELEGRAM_KNOWLEDGE_CLOSED));
const TG_OPEN_SEARCH = makeTgSearch(chunkTg(TELEGRAM_KNOWLEDGE));

// Бюджет выдачи: ~30k символов ≈ ~10k токенов → ~$0.05 холодного входа на Opus.
const TG_BUDGET_CHARS = 30000;

/**
 * Собрать system-блок из релевантных секций канала под бюджет. Берём top-кандидатов
 * по BM25 и набираем, пока не упрёмся в бюджет. Обрамление «копируй дословно» — как
 * у книги (LLM лучше копирует примеры, чем выполняет правила). Пусто — если не нашли.
 */
export function buildTgContextBlock(
  query: string,
  channel: "closed" | "open",
  budgetChars = TG_BUDGET_CHARS
): string {
  const search = channel === "closed" ? TG_CLOSED_SEARCH : TG_OPEN_SEARCH;
  const hits = search(query, 60);
  if (hits.length === 0) return "";
  const picked: TgChunk[] = [];
  let used = 0;
  for (const h of hits) {
    if (picked.length > 0 && used + h.chunk.text.length > budgetChars) break;
    picked.push(h.chunk);
    used += h.chunk.text.length;
  }
  const label = channel === "closed" ? "закрытого" : "публичного";
  const body = picked
    .map((c) => (c.section ? `[${c.section}]\n${c.text}` : c.text))
    .join("\n\n— — —\n\n");
  return (
    `# Посты из моего ${label} Telegram-канала по теме запроса\n\n` +
    `Это мои реальные формулировки, кейсы и приёмы. Бери из них обороты, структуру и ` +
    `конкретику ДОСЛОВНО — копируй форму, не пересказывай. Чего тут нет — не выдумывай, ` +
    `скажи прямо.\n\n` +
    body
  );
}
