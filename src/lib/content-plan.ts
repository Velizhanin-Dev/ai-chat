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
// ⚠️ "dump" («свалка») — вход на доску, а не этап работы: сюда кидают всё, что
// зацепило, — мысль в одну строку, чужой ролик, тему из комментариев. Оттуда
// материал уходит либо в «Идею» руками, либо в генерацию плана (её промпт
// читает свалку, см. generatePlanVideos). Держать это в «Идеях» нельзя: там
// карточки уже с методикой — название, боль, скелет, — а свалка нужна ровно для
// того, чтобы записать не думая и не потерять.
export const STATUSES = ["dump", "idea", "in_progress", "published", "cancelled"] as const;
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
  dump: { key: "dump", label: "Свалка идей", color: "yellow" },
  idea: { key: "idea", label: "Идея", color: "gray" },
  in_progress: { key: "in_progress", label: "В работе", color: "brand" },
  published: { key: "published", label: "Опубликовано", color: "teal" },
  cancelled: { key: "cancelled", label: "Отменено", color: "red" },
};
// Колонки канбана (отменённые — вне досок, показываем свёрнуто отдельно).
export const BOARD_COLUMNS: VideoStatus[] = ["dump", "idea", "in_progress", "published"];

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
  /**
   * Из какого плана карточка — заполняется ТОЛЬКО у «перенесённых» (см.
   * ContentPlanView.carried). У своих карточек null: подпись «из плана Июль»
   * на карточке июльского плана была бы шумом.
   */
  planLabel?: string | null;
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

// Возражение клиента и то, чем его снимают.
//
// ⚠️ Возражение ≠ боль. Боль — «хочу переехать, но страшно», возражение — «а вдруг
// застройщик не достроит». Боль двигает к покупке, возражение мешает, и снимаются
// они РАЗНЫМ контентом. В портретах ЦА у нас были только боли, поэтому продающие
// ролики выходили беззубыми.
export interface Objection {
  /** Как это звучит из уст клиента. */
  text: string;
  /** Чем снимаем: аргумент, факт, кейс. */
  answer: string;
  /** Каким роликом это закрыть (формат/тема). */
  video: string;
}

// Характеристика → человеческая выгода.
//
// ⚠️ Главный приём продающего контента: «двор без машин» — это характеристика, а
// «ребёнка можно спокойно отпускать гулять одного» — то, за что платят. Выгода —
// это «В» в ВИСП, то есть методика прямо про это.
export interface BenefitPair {
  feature: string;
  benefit: string;
}

// Шаг воронки: от ролика до заявки.
//
// ⚠️ Это НЕ «сколько снимать охватного и продающего» — то была прежняя воронка, и
// её убрали как дубль контент-плана. Здесь путь КЛИЕНТА: что он видит, что делает
// дальше и чем мы его ведём.
export interface FunnelStep {
  /** Где человек находится: «увидел рилс», «зашёл на канал», «написал в директ». */
  step: string;
  /** Что должно произойти на этом шаге. */
  goal: string;
  /** Каким контентом ведём. */
  content: string;
  /** Что говорим/предлагаем (CTA, лид-магнит). */
  action: string;
}

// Какие опорные блоки умеем генерировать.
// ⚠️ «Воронка» убрана из списка (решение владельца): сколько снимать охватного /
// экспертного / продающего — это и есть сам контент-план, блок дублировал его.
// Поле funnel в модели плана и тип Funnel оставлены — у старых планов блок уже
// собран, ломать сохранённые данные незачем; просто больше не предлагаем собрать.
export const BLOCKS = ["audience", "hunt", "objections", "benefits", "reasons", "funnel", "shorts"] as const;
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
  objections: {
    label: "Возражения и ответы",
    hint: "Что мешает сказать «да» и каким роликом это снять",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  benefits: {
    label: "Характеристики → выгоды",
    hint: "Перевод сухих свойств в то, за что платят",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  reasons: {
    label: "Причины купить",
    hint: "Большой банк причин — из них растут темы роликов",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  funnel: {
    label: "Воронка до заявки",
    hint: "Путь клиента по шагам: от ролика до обращения",
    cost: CONTENT_PLAN_BLOCK_QUOTA_COST,
  },
  shorts: {
    label: "Сетка шортсов",
    hint: "Лёгкая сетка коротких: хук + референс",
    cost: CONTENT_PLAN_SHORTS_QUOTA_COST,
  },
};

/**
 * Сколько причин просим в банке.
 *
 * ⚠️ Сотня — это НЕ нарушение лимита вывода из OUTPUT_DISCIPLINE: тот ограничивает
 * тяжёлые артефакты в ОТВЕТЕ ЧАТА (сценарии, планы), а здесь отдельный блок, где
 * ценность именно в количестве — из ста причин десяток окажется золотым, и заранее
 * не угадать какой.
 */
export const REASONS_COUNT = 100;

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
  /**
   * Карточки из ДРУГИХ планов проекта, которые сейчас «в работе» или уже
   * «опубликованы».
   *
   * ⚠️ Зачем отдельным полем, а не подмешиванием в videos: работа над роликом не
   * заканчивается вместе с месяцем — тему завели в июле, снимают в августе. При
   * переключении месяца такие карточки пропадали с глаз, и человек считал, что
   * они потерялись. Теперь колонки «В работе» и «Опубликовано» показывают их
   * всегда, а `videos` остаётся ровно тем, что относится к ЭТОМУ плану: на нём
   * держатся счётчики, проверка тем и сборка опорных блоков.
   */
  carried: VideoView[];
  // Опорные блоки (Фаза 3) — null, пока не сгенерированы.
  audience: Persona[] | null;
  huntLadder: HuntStep[] | null;
  funnel: Funnel | null;
  objections: Objection[] | null;
  benefits: BenefitPair[] | null;
  reasons: string[] | null;
  funnelSteps: FunnelStep[] | null;
}

// Заголовок карточки — первый вариант названия (или заглушка).
export function primaryTitle(v: VideoView): string {
  return v.titles[0]?.trim() || "Без названия";
}

// ── Шортс: другой набор полей ───────────────────────────────────────────────
// ⚠️ У шортса НЕТ названия и текста на превью — есть ОПИСАНИЕ (подпись под
// роликом) и ПЕРВАЯ ФРАЗА (хук в первые 3 секунды). Поля БД те же, что у лонга,
// меняется смысл: `titles[0]` = описание, `opening` = первая фраза. Формат, 10
// вопросов, ВИСП, нативное закрытие и «почему залетит» к шортсу не относятся —
// ни на карточке, ни в панели их не показываем (правка редактора, 2026-09-03).
export function isShortVideo(v: Pick<VideoView, "kind">): boolean {
  return v.kind === "short";
}

/** Первая фраза шортса для карточки; у старых шортсов без opening — описание. */
export function shortHeadline(v: VideoView): string {
  return v.opening?.trim() || primaryTitle(v);
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
// У шортса переделывается только описание (`titles`): превью, вопросов и формата
// у него нет (см. isShortVideo).
export const SHORT_REGEN_PARTS: readonly RegenPart[] = ["titles"];
export const SHORT_REGEN_LABEL: Partial<Record<RegenPart, string>> = { titles: "описание" };

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
