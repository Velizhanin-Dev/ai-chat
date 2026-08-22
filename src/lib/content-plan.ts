// ── Контент-план: чистый модуль (клиент/сервер, без prisma) ─────────────────
// Типы, статусы, стоимости, форматы. Методика — docs/content-plan.md +
// CONTENT_PLAN_GUIDE (knowledge-base-content-plans.ts).

// Стоимость в запросах квоты (как у превью/разбора).
export const CONTENT_PLAN_GENERATE_QUOTA_COST = 25; // генерация плана на месяц
export const CONTENT_PLAN_EDIT_QUOTA_COST = 1; // переделка части одной карточки
// Опорные блоки (Фаза 3): портреты ЦА / лестница Ханта / воронка — лёгкий JSON,
// сетка шортсов — пачка строк, поэтому дороже. Цифры не из методики, а наши —
// правятся здесь.
export const CONTENT_PLAN_BLOCK_QUOTA_COST = 1;
// Переработка залетевшего ролика конкурента в свою карточку плана. Дороже правки
// одной части (2 против 1): кроме генерации мы ходим за разбором ролика-донора
// (~3 units YouTube) и за его расшифровкой — то есть ответ строится на фактуре,
// а не на одном заголовке.
export const CONTENT_PLAN_ADAPT_QUOTA_COST = 2;
export const CONTENT_PLAN_SHORTS_QUOTA_COST = 5;

// Сколько шортсов в сетке по умолчанию. 16 — решение владельца: шортсов на канал
// нужно вдвое больше, чем лонгов (верх воронки и холодный охват).
export const DEFAULT_SHORTS_COUNT = 16;

// Сколько ЛОНГОВ в месячной сетке. ФИКСИРОВАНО: 8 (пользователь не выбирает —
// решение владельца). Методика допускает 8–12, продукт даёт ровно 8; шортсов к ним
// вдвое больше — DEFAULT_SHORTS_COUNT выше.
export const PLAN_VIDEO_COUNT = 8;
export const MAX_VIDEO_COUNT = 16; // потолок нормализации ответа модели

// Ступени лестницы Ханта — подсказка (?) рядом с полем в карточке ролика.
export const HUNT_LADDER_HINT = [
  "1. Нет проблемы — доволен, боль не осознаёт.",
  "2. Есть проблема, НЕ ЗНАЕТ о ней — охватное «а вы знали, что…».",
  "3. Знает о проблеме, но НЕ ПАРИТ — откладывает.",
  "4. Парит, но НЕ ЗНАЕТ, КАК РЕШАТЬ — самый сочный сегмент под экспертное.",
  "5. Знает решение, выбирает исполнителя — тёплый, ловим кейсом и оффером.",
];

// ── Статусы (канбан) ────────────────────────────────────────────────────────
export const STATUSES = ["idea", "in_progress", "published", "cancelled"] as const;
export type VideoStatus = (typeof STATUSES)[number];
export function isStatus(v: string): v is VideoStatus {
  return (STATUSES as readonly string[]).includes(v);
}

export interface StatusMeta {
  key: VideoStatus;
  label: string;
  color: string; // Mantine-цвет
}
export const STATUS_META: Record<VideoStatus, StatusMeta> = {
  idea: { key: "idea", label: "Идея", color: "gray" },
  in_progress: { key: "in_progress", label: "В работе", color: "brand" },
  published: { key: "published", label: "Опубликовано", color: "teal" },
  cancelled: { key: "cancelled", label: "Отменено", color: "red" },
};
// Колонки канбана (отменённые — вне досок, показываем свёрнуто отдельно).
export const BOARD_COLUMNS: VideoStatus[] = ["idea", "in_progress", "published"];

// ── Форматы ролика ──────────────────────────────────────────────────────────
export type VideoFormat = "reach" | "expert" | "selling";
export const FORMAT_META: Record<VideoFormat, { label: string; color: string }> = {
  reach: { label: "Охватное", color: "blue" },
  expert: { label: "Экспертное", color: "grape" },
  selling: { label: "Продающее", color: "orange" },
};
export function formatMeta(v: string | null | undefined) {
  return v && v in FORMAT_META ? FORMAT_META[v as VideoFormat] : null;
}

export type VideoKind = "video" | "short";
// ⚠️ "competitor" — карточка, заведённая из раздела «Референсы» по залетевшему
// ролику конкурента: в reference лежит ссылка на донора, а название — ЗАГОТОВКА,
// которую надо переписать под себя (методика прямо запрещает копировать чужое).
export type VideoSource = "ai" | "manual" | "imported" | "competitor";

// ВИСП-галочки (Выгода / Интрига / Срочность / Причастность).
export interface Visp {
  v: boolean;
  i: boolean;
  s: boolean;
  p: boolean;
}

// Набор СТА для ролика.
export interface Cta {
  like?: string;
  subscribe?: string;
  comment?: string;
  link?: string;
  leadMagnet?: string;
}

// ── Витрина (то, что уходит на клиент) ──────────────────────────────────────
export interface VideoView {
  id: string;
  order: number;
  kind: VideoKind;
  status: VideoStatus;
  source: VideoSource;
  titles: string[];
  previewTexts: string[];
  format: VideoFormat | null;
  noSpeaker: boolean;
  huntStage: string | null;
  pain: string | null;
  questions: string[];
  nativeClose: string | null;
  cta: Cta | null;
  visp: Visp | null;
  reference: string | null;
  whyWorks: string | null;
  opening: string | null;
  youtubeVideoId: string | null;
  thumbnail: string | null;
  views: number | null;
}

// ── Опорные блоки (Фаза 3) ──────────────────────────────────────────────────
// Портрет сегмента ЦА: кто, на какой стадии Ханта, боли от 1 лица, что оттолкнёт.
export interface Persona {
  name: string;
  who: string;
  huntStage: string;
  pains: string[];
  turnOff: string;
}

// Ступень лестницы Ханта под нишу: состояние → внутренние диалоги → что заходит.
export interface HuntStep {
  stage: string;
  state: string;
  thoughts: string[];
  content: string;
  topics: string[];
}

// Распределение роликов по воронке (сколько чего снимать и зачем).
export interface FunnelPart {
  format: VideoFormat;
  share: number; // доля 0..1
  goal: string;
}
export interface Funnel {
  parts: FunnelPart[];
  note: string;
}

// Какие опорные блоки умеем генерировать.
// ⚠️ «Воронка» убрана из списка (решение владельца): сколько снимать охватного /
// экспертного / продающего — это и есть сам контент-план, блок дублировал его.
// Поле funnel в модели плана и тип Funnel оставлены — у старых планов блок уже
// собран, ломать сохранённые данные незачем; просто больше не предлагаем собрать.
export const BLOCKS = ["audience", "hunt", "shorts"] as const;
export type BlockKey = (typeof BLOCKS)[number];
export const BLOCK_META: Record<BlockKey, { label: string; hint: string; cost: number }> = {
  audience: {
    label: "Портреты ЦА",
    hint: "3–4 сегмента: кто, боли от первого лица, что оттолкнёт",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  hunt: {
    label: "Лестница Ханта",
    hint: "5 ступеней осознанности под твою нишу с темами-зацепками",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  shorts: {
    label: "Сетка шортсов",
    hint: "Лёгкая сетка коротких: хук + референс",
    cost: CONTENT_PLAN_SHORTS_QUOTA_COST,
  },
};

export interface ContentPlanMeta {
  id: string;
  period: string;
  label: string;
  niche: string | null;
  createdAt: string;
  videoCount: number;
  publishedCount: number;
}

export interface ContentPlanView extends ContentPlanMeta {
  videos: VideoView[];
  // Опорные блоки (Фаза 3) — null, пока не сгенерированы.
  audience: Persona[] | null;
  huntLadder: HuntStep[] | null;
  funnel: Funnel | null;
}

// Заголовок карточки — первый вариант названия (или заглушка).
export function primaryTitle(v: VideoView): string {
  return v.titles[0]?.trim() || "Без названия";
}

// ── Связь с реальными видео канала (Фаза 2) ─────────────────────────────────
// Ролик канала для пикера привязки/импорта.
export interface LinkVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  views: number;
  publishedAt: string;
}

// Части карточки, которые можно переделать ИИ (1 запрос).
export const REGEN_PARTS = ["titles", "previewTexts", "questions", "format"] as const;
export type RegenPart = (typeof REGEN_PARTS)[number];
export const REGEN_LABEL: Record<RegenPart, string> = {
  titles: "названия",
  previewTexts: "текст на превью",
  questions: "10 вопросов",
  format: "формат и подачу",
};

// Нормализация заголовка для сравнения (регистр, пунктуация, пробелы). Класс
// символов задан явно (кириллица+латиница+цифры), без \p{…}/u — чтобы не зависеть
// от target компилятора.
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return normTitle(s)
    .split(" ")
    .filter((w) => w.length > 2);
}

// Похожесть двух заголовков 0..1 — Жаккар по словам (устойчиво к перестановке и
// лишним словам, чего достаточно для «это похоже на твой ролик X»).
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = new Set(words(b));
  if (wa.length === 0 || wb.size === 0) return 0;
  const uniqA = new Set(wa);
  let inter = 0;
  uniqA.forEach((w) => {
    if (wb.has(w)) inter += 1;
  });
  return inter / (uniqA.size + wb.size - inter);
}

// Лучшее совпадение ролика плана среди видео канала (выше порога → предлагаем).
export const MATCH_THRESHOLD = 0.4;
export function bestMatch(planTitle: string, videos: LinkVideo[]): LinkVideo | null {
  let best: LinkVideo | null = null;
  let bestScore = MATCH_THRESHOLD;
  for (const v of videos) {
    const s = titleSimilarity(planTitle, v.title);
    if (s >= bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

// Ключ и метка текущего месяца (для генерации нового плана). Передаём время
// снаружи там, где важна детерминированность; по умолчанию — сейчас.
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
