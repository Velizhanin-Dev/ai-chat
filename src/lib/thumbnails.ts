import type { Platform } from "./platform";
// ── Генератор превью: спека + сборка промпта для image-модели ────────────────
// Чистый модуль (без prisma/fs) — общий для клиента и сервера.
//
// Идея: пользователь заполняет спеку по-русски (или её предлагает нейронка по
// методике — см. POST /api/thumbnails/spec), а отсюда собирается АНГЛИЙСКИЙ
// промпт для image-модели: они заметно точнее следуют английским инструкциям,
// при этом текст НА картинке остаётся русским и рендерится дословно.
//
// Правила промпта — это методичка арт-дирекшена студии из базы знаний
// (knowledge-base-tg-closed.ts «Дизайн превью», «Три кита превью», «Баннерная
// слепота», «Стратегии превью под ЦА» + knowledge-base-youtube.ts «Превью и
// обложки» / «Превью: конкретика с разборов»). Меняешь правила в базе — правь и здесь.

export type ThumbnailKind = "reference" | "generation";

// Строка истории (референс или генерация) в том виде, в каком её отдаёт API.
// Файл не инлайним — приходит ссылкой на /api/thumbnails/<id>/file.
export interface ThumbnailRow {
  id: string;
  kind: ThumbnailKind;
  role: RefRole;
  label: string;
  url: string;
  mimeType: string;
  bytes: number;
  refIds: string[];
  spec: ThumbnailSpec | null;
  model: string;
  createdAt: string;
  // Вариации: перегенерация из редактора ссылается на исходное превью.
  // null — корень группы (или референс).
  parentId: string | null;
  // Референс с «применять всегда» — держит единый стиль превью на канале.
  pinned: boolean;
}

// Что нейронка предлагает по методике (шаг «Предложить заголовки»).
export interface ThumbnailIdeas {
  // Названия ролика по ВИСП (рацио + SEO).
  titles: string[];
  // Варианты текста НА превью (эмоция; не дублируют название).
  thumbTexts: { text: string; keyWord: string; why: string }[];
  // Подсказки по кадру — подставляются в форму одним кликом.
  supportObject: string;
  emotion: string;
  palette: string;
}

// Роль референса в кадре. Спикера переносим по личности, объект — по форме.
export type RefRole = "speaker" | "object" | "style";

export const REF_ROLE_LABEL: Record<RefRole, string> = {
  speaker: "Спикер",
  object: "Объект",
  style: "Стиль/референс",
};

export function normalizeRefRole(v: unknown): RefRole {
  return v === "object" || v === "style" ? v : "speaker";
}

// ── Стили превью ────────────────────────────────────────────────────────────
// ⚠️ Стиль и ЦА — ДВЕ РАЗНЫЕ ОСИ. Раньше они были слиты в один пресет («Масс-сегмент
// / DIY» по сути и был стилем «на коленке», а «Строгий B2B» — «стильным»), поэтому
// нельзя было сделать, например, стильное превью для масс-сегмента. Теперь стиль
// отвечает за ПОДАЧУ (насколько причёсано, что в кадре), ЦА — за ограничения
// (кегль текста, палитра, регистр эмоции). Пять стилей доступны любой ЦА.
//
// Опора из базы (knowledge-base-tg-closed.ts:856): «Для медийных топов — лаконичный
// "дорогой" минимализм (лицо само тянет клик); для ноунеймов — "павлиний хвост",
// максимально ярко».

/** Нужно ли фото спикера: обязательно / можно без него / стиль без людей. */
export type SpeakerNeed = "required" | "optional" | "none";

export interface ThumbSubStyle {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  speaker: SpeakerNeed;
}

export interface ThumbStyle {
  id: string;
  label: string;
  hint: string; // подсказка в UI, по-русски
  prompt: string; // что уходит в модель, по-английски
  speaker: SpeakerNeed;
  /** Примеры для галереи выбора: /images/thumb-styles/<id>/*. Только для глаза
   *  пользователя — в модель НЕ уходят (решение владельца). */
  examples: string[];
  subStyles?: ThumbSubStyle[];
}

export const THUMB_STYLES: ThumbStyle[] = [
  {
    id: "standard",
    label: "Стандартный",
    hint: "Спикер справа с эмоцией и жестом, текст в левом верхнем углу (главное слово цветом и крупнее), на фоне — объект из ролика с красными кружками и стрелками на важном.",
    speaker: "required",
    examples: [],
    prompt:
      "STANDARD LAYOUT — follow the placement literally:\n" +
      "- Place the speaker in the RIGHT part of the frame, with a clear emotion on the face and some hand gesture.\n" +
      "- Put the caption in the UPPER LEFT part of the frame. The key word is set in a different colour and slightly larger type than the rest of the caption.\n" +
      "- The background is the OBJECT the video is about. Mark its important elements with red circles and/or red arrows drawn on top.\n" +
      "- The object must hit the viewer's sense of belonging: it should be something the viewer already owns or wants to own, shown exactly in the state depicted.",
  },
  {
    id: "homemade",
    label: "Состряпанное на коленке",
    hint: "Методика зовёт это «говнопревью». Максимально колхозный вариант для низкобюджетных продуктов и ниш: обычное фото, стандартный шрифт поверх и несоизмеримо огромная стрелка на важное. Вылизанность здесь СНИЖАЕТ CTR.",
    speaker: "optional",
    examples: [],
    prompt:
      "DELIBERATELY CRUDE ('kolkhoz') LAYOUT — this cheapness is intentional, do not beautify:\n" +
      "- Base is a plain, ordinary, amateur-looking photograph of the subject, as if grabbed from the internet. No studio lighting, no retouching, no artistic composition.\n" +
      "- The caption is written straight on top of that photo in a plain default heavy sans-serif, as if typed in a basic editor. No effects, no gradients, no glow, no shadows, no designer polish.\n" +
      "- MANDATORY: one absurdly oversized arrow pointing at an important element of the object. The arrow must be disproportionately huge — far bigger than any designer would allow.\n" +
      "Suits low-budget products and niches. Any polish here LOWERS click-through.",
  },
  {
    id: "styled",
    label: "Стильный",
    hint: "Затемнённый фон съёмки, спикер крупно (чуть ниже плеч), добрая улыбка — в том числе глазами, контур отделяет от фона, обязательно рука с выразительным жестом.",
    speaker: "required",
    examples: [],
    prompt:
      "POLISHED LAYOUT — follow the placement literally:\n" +
      "- Darken the background the speaker was filmed against, so the speaker separates from it.\n" +
      "- Place the speaker LARGE in the frame, cropped just below the shoulders.\n" +
      "- The face must carry a warm, kind, friendly emotion — a genuine smile that reaches the eyes, not just the mouth.\n" +
      "- Separate the speaker from the background with a visible outline/rim around the speaker's silhouette.\n" +
      "- MANDATORY: include the speaker's hand or hands making a meaningful gesture (pointing up, pointing at camera, OK sign, thumbs up, open palm, victory sign or similar).",
  },
  {
    id: "showing",
    label: "«Щас покажу»",
    hint: "Спикер с грозной эмоцией, план крупнее обычного; объект — в левом нижнем углу, спикер одной рукой его держит, второй показывает на важную часть. Можно обвести красным.",
    speaker: "required",
    examples: [],
    prompt:
      "'LOOK AT THIS' LAYOUT — follow the placement literally:\n" +
      "- The speaker carries a stern, grim, serious emotion. Not a smile.\n" +
      "- Frame tighter than usual: a closer shot of the speaker.\n" +
      "- The object the video is about is visible in the LOWER LEFT part of the frame.\n" +
      "- Parts of the speaker's hands must be visible: one hand holds the object, the other hand points at an important part of that object.\n" +
      "- Optionally mark that important part with a light red circle.",
  },
  // ⚠️ ЕДИНСТВЕННЫЙ СТИЛЬ, ПРОМПТ КОТОРОГО НЕ ПРИСЛАН ВЛАДЕЛЬЦЕМ. Остальные четыре
  // — его дословные формулировки из рабочего чата (4 августа 2026). Подстили ниже —
  // ЧЕРНОВИК, собранный по упоминаниям в базе (док.фильмы для Гребенюка, Циан как
  // источник оттестированных объявлений, «для медийных топов — дорогой минимализм»,
  // knowledge-base-tg-closed.ts:856). Придут его формулировки — заменить дословно.
  {
    id: "special",
    label: "Спецпроекты",
    hint: "Отдельная эстетика под формат: документальный фильм, рекламно-каталожный кадр или медийный топ. ЧЕРНОВИК — ждём формулировки.",
    speaker: "optional",
    examples: [],
    prompt: "",
    subStyles: [
      {
        id: "doc",
        label: "Документальный фильм",
        hint: "Кинематографичный кадр, киношная цветокоррекция, крупный титр. Без кликбейт-плашек и стрелок.",
        speaker: "optional",
        prompt:
          "Cinematic documentary key art: filmic colour grading, anamorphic-style shallow depth of field, dramatic motivated lighting, muted contrasty palette. Title set as a restrained film-poster caption. No clickbait plates, no arrows, no stickers, no saturated YouTube styling.",
      },
      {
        id: "catalog",
        label: "Рекламно-каталожный",
        hint: "Как объявления на агрегаторах (Циан и подобные): объект как товар, чистый фон, плашка с ключевым параметром.",
        speaker: "none",
        prompt:
          "Catalogue/classified-ad aesthetic: the object presented as merchandise on a clean uncluttered background, even commercial lighting, a single tidy label plate carrying the key parameter (price, size, term). Sober trustworthy palette. Looks like a paid listing, not like entertainment content.",
      },
      {
        id: "media",
        label: "Медийный топ",
        hint: "Как у известного спикера: дорогой минимализм, лицо крупно, почти без текста. Лицо само тянет клик.",
        speaker: "required",
        prompt:
          "Premium personality-led key art: the face very large and beautifully lit, near-zero text (at most two words), sophisticated restrained palette, editorial magazine quality. The recognisable person is the entire hook — nothing competes with the face.",
      },
    ],
  },
];

export function thumbStyleById(id: string): ThumbStyle {
  return THUMB_STYLES.find((s) => s.id === id) ?? THUMB_STYLES[0];
}

export function thumbSubStyleById(
  styleId: string,
  subId: string
): ThumbSubStyle | null {
  const st = THUMB_STYLES.find((s) => s.id === styleId);
  return st?.subStyles?.find((s) => s.id === subId) ?? null;
}

/** Нужно ли на этом стиле (с учётом подстиля) фото спикера. */
export function speakerNeedFor(styleId: string, subId: string): SpeakerNeed {
  const sub = thumbSubStyleById(styleId, subId);
  if (sub) return sub.speaker;
  return thumbStyleById(styleId).speaker;
}

// ── Целевая аудитория ───────────────────────────────────────────────────────
// Вторая ось (первая — стиль выше). Ключевая мысль методики: превью конгруэнтно
// аудитории, а не «красиво». Кейс «Живой русской бани»: дизайнерские превью
// уронили канал, вернули «говнястые» — вырос. ЦА задаёт ОГРАНИЧЕНИЯ (кегль,
// палитра, регистр эмоции), а не раскладку кадра — раскладка живёт в стиле.
export interface AudiencePreset {
  id: string;
  label: string;
  hint: string; // подсказка в UI, по-русски
  prompt: string; // что уходит в модель, по-английски
}

export const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    id: "mass",
    label: "Масс-сегмент / DIY",
    hint: "Стройка, ремонт, дача, авто. Простые слова, крупно, без изысков — «павлиний хвост» работает лучше сдержанности.",
    prompt:
      "Mass-market DIY audience: loud saturated colours, maximum contrast, simple everyday objects, nothing abstract or conceptual. Bright and busy beats tasteful and restrained here.",
  },
  {
    id: "b2b",
    label: "Строгий B2B / финансы",
    hint: "Сухо, серая база, красный только акцентом. Утрированные эмоции снижают статус спикера.",
    prompt:
      "B2B / finance audience: desaturated grey base, red only as a small accent, composed serious expression, no theatrical open-mouth emotion, no clutter. Exaggerated emotion lowers the speaker's status with this audience.",
  },
  {
    id: "senior",
    label: "Старшая ЦА",
    hint: "Огромный текст гротеском, без градиентов и теней, спикер в профессиональной одежде.",
    prompt:
      "Very large heavy grotesque (sans-serif) text, maximum legibility, no gradients, no drop shadows, no thin strokes. Speaker in professional, trustworthy clothing. Calm restrained palette.",
  },
  {
    id: "female",
    label: "Женская / бьюти / wellness",
    hint: "Светлый мягкий фон, сдержанные позы, розовый только акцентом (неон на чёрном приводит не ту аудиторию).",
    prompt:
      "Light soft background, gentle restrained pose, pink only as a small accent — never neon-on-black. Warm, clean, non-aggressive look.",
  },
  {
    id: "young",
    label: "Молодёжь / дети",
    hint: "Максимальная насыщенность, крупные предметы, театральная эмоция.",
    prompt:
      "Maximum saturation and contrast, big bold props, theatrical exaggerated open-mouth emotion, playful energetic composition.",
  },
  {
    id: "neutral",
    label: "Без пресета",
    hint: "Модель выберет стиль по нише и описанию.",
    prompt: "",
  },
];

export function audiencePresetById(id: string): AudiencePreset {
  return (
    AUDIENCE_PRESETS.find((p) => p.id === id) ??
    AUDIENCE_PRESETS[AUDIENCE_PRESETS.length - 1]
  );
}

// Система бальности референса из студийного ТЗ на превью.
export const REF_SCORES = [
  { value: "1", label: "1 — ориентироваться не надо" },
  { value: "3", label: "3 — повторить конкретный элемент" },
  { value: "5", label: "5 — копировать композицию один в один" },
] as const;

export interface ThumbnailSpec {
  // Что за ролик — контекст для модели.
  videoSummary: string;
  // Название ролика (чтобы текст на превью его НЕ дублировал — институт тавтологии).
  videoTitle: string;
  // Главное поле: что именно хотим видеть в кадре, своими словами.
  instructions: string;
  // Текст на превью (русский, дословно рендерится) + ключевое слово капсом.
  thumbText: string;
  keyWord: string;
  // Один доп-элемент среднего плана (методика: одна превью — одна идея).
  supportObject: string;
  // Эмоция спикера — должна биться с темой.
  emotion: string;
  // Палитра словами + почему (психология цвета под нишу/ЦА).
  palette: string;
  audiencePreset: string;
  // Стиль подачи (THUMB_STYLES) и подстиль для «Спецпроектов». Отдельная ось от ЦА.
  style: string;
  subStyle: string;
  // Сколько людей в кадре: 0 (без спикера), 1 (по умолчанию), 2 (максимум).
  peopleCount: number;
  niche: string;
  audience: string;
  // Бальность референса стиля (1/3/5) + что именно копировать при 3.
  refScore: string;
  refElement: string;
}

export const EMPTY_SPEC: ThumbnailSpec = {
  videoSummary: "",
  videoTitle: "",
  instructions: "",
  thumbText: "",
  keyWord: "",
  supportObject: "",
  emotion: "",
  palette: "",
  style: "standard",
  subStyle: "",
  audiencePreset: "neutral",
  peopleCount: 1,
  niche: "",
  audience: "",
  refScore: "1",
  refElement: "",
};

// Лимиты полей (совпадают с валидацией на сервере).
export const SPEC_LIMITS: Record<keyof ThumbnailSpec, number> = {
  videoSummary: 1200,
  videoTitle: 200,
  instructions: 2000,
  thumbText: 80,
  keyWord: 40,
  supportObject: 200,
  emotion: 200,
  palette: 200,
  audiencePreset: 20,
  style: 24,
  subStyle: 24,
  peopleCount: 1,
  niche: 120,
  audience: 200,
  refScore: 1,
  refElement: 200,
};

export const MAX_REFERENCES = 6;
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

// Стоимость операций генератора превью в единицах квоты запросов.
// Одна сгенерированная картинка — тяжёлая операция (Nano Banana Pro ~$0.13-0.15),
// поэтому списывает 10 запросов; «Предложить по методике» — обычный текстовый
// вызов, 1 запрос. Чистые константы, общие клиенту (оптимистичное списание в
// шапке) и серверу (реальное списание в quota).
export const THUMBNAIL_GENERATE_QUOTA_COST = 10;
export const THUMBNAIL_SPEC_QUOTA_COST = 1;

// ── Пунктуация: у картинки и у названия РАЗНЫЕ правила ──────────────────────
//
// ⚠️ НЕ ПУТАТЬ (на этом уже ошибались):
//  • ТЕКСТ НА КАРТИНКЕ — знаков препинания нет ВООБЩЕ. Ни точки, ни запятой, ни
//    «?», ни «!», ни «|», ни «/». На мелком превью в ленте любой знак читается
//    как грязь и отъедает кегль у главного слова.
//  • НАЗВАНИЕ РОЛИКА — знаки нужны и разрешены: «.», «?», «!», «|», «/». Ими и
//    режется мысль. Запрещены только запятые, двоеточия, точки с запятой,
//    тире-разделители, кавычки, скобки и многоточия.
//
// Чистим ЗДЕСЬ, в санитайзере, а не просьбой в промпте: image-модель рисует ровно
// те символы, что мы дали между [TEXT]…[/TEXT], и «не рисуй запятую» она нарушит
// именно тогда, когда запятая есть во входе. Чиним вход.
//
// ⚠️ Дефис в классы НЕ ставим: он нужен внутри слов («из-за», «онлайн-курс»).
// Тире-разделитель убираем отдельным правилом — только когда оно окружено
// пробелами. Иначе «из-за» превращается в «из за».
const DASH_SEPARATOR = /\s+[—–-]\s+/g;

// Текст на картинке: под нож всё, включая «?», «!», «|» и «/».
const THUMB_TEXT_PUNCT = /[.,;:!?|/«»"'“”„()\[\]{}…]/g;

export function stripThumbTextPunctuation(s: string): string {
  return s
    .replace(DASH_SEPARATOR, " ")
    .replace(THUMB_TEXT_PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Название ролика: «.», «?», «!», «|», «/» остаются — они и делят мысль.
const TITLE_PUNCT = /[,;:«»"'“”„()\[\]{}…]/g;

export function stripTitlePunctuation(s: string): string {
  return s
    .replace(DASH_SEPARATOR, " ")
    .replace(TITLE_PUNCT, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([|/?!.])/g, "$1")
    .trim();
}

export function sanitizeSpec(input: unknown): ThumbnailSpec {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (key: keyof ThumbnailSpec): string => {
    const v = o[key];
    return typeof v === "string" ? v.trim().slice(0, SPEC_LIMITS[key]) : "";
  };
  const people = Number(o.peopleCount);
  const styleId = thumbStyleById(str("style")).id;
  return {
    videoSummary: str("videoSummary"),
    videoTitle: stripTitlePunctuation(str("videoTitle")),
    instructions: str("instructions"),
    // Пунктуацию срезаем на входе — см. stripThumbTextPunctuation выше.
    thumbText: stripThumbTextPunctuation(str("thumbText")),
    keyWord: stripThumbTextPunctuation(str("keyWord")),
    supportObject: str("supportObject"),
    emotion: str("emotion"),
    palette: str("palette"),
    audiencePreset: audiencePresetById(str("audiencePreset")).id,
    style: styleId,
    subStyle: thumbSubStyleById(styleId, str("subStyle"))?.id ?? "",
    peopleCount: people === 0 || people === 2 ? people : 1,
    niche: str("niche"),
    audience: str("audience"),
    refScore: str("refScore") === "3" || str("refScore") === "5" ? str("refScore") : "1",
    refElement: str("refElement"),
  };
}

// Минимум, без которого генерировать бессмысленно: выбран стиль (у «Спецпроектов»
// ещё и подстиль — у самого стиля своего промпта нет) и сказано, о чём ролик.
export function isSpecReady(spec: ThumbnailSpec): boolean {
  const style = thumbStyleById(spec.style);
  if (style.subStyles?.length && !thumbSubStyleById(spec.style, spec.subStyle)) {
    return false;
  }
  return Boolean(spec.instructions.trim() || spec.videoSummary.trim());
}

// ── Сборка промпта ──────────────────────────────────────────────────────────

// Экспортируется, потому что мастер собирает ТОТ ЖЕ промпт на клиенте для экрана
// предпросмотра: человек должен видеть ровно то, что уйдёт в модель, а не похожее.
export interface PromptRef {
  role: RefRole;
  label: string;
}

function refLegend(refs: PromptRef[]): string {
  if (refs.length === 0) {
    return "No reference images supplied — generate everything from the description below. Ignore the IDENTITY LOCK and OBJECT LOCK sections.";
  }
  return refs
    .map((r, i) => {
      const n = i + 1;
      const note = r.label ? ` (${r.label})` : "";
      if (r.role === "speaker") {
        return `Image ${n} = the speaker${note}. Identity reference — see IDENTITY LOCK.`;
      }
      if (r.role === "object") {
        return `Image ${n} = an object/prop${note} that must appear in the frame — see OBJECT LOCK.`;
      }
      return `Image ${n} = a style/composition reference${note} — see REFERENCE SCORE.`;
    })
    .join("\n");
}

function refScoreLine(spec: ThumbnailSpec, hasStyleRef: boolean): string {
  if (!hasStyleRef) return "";
  if (spec.refScore === "5") {
    return "REFERENCE SCORE 5 — copy the style reference's composition one-to-one, replacing the people/objects with the ones supplied here and restyling to the palette below.";
  }
  if (spec.refScore === "3") {
    return `REFERENCE SCORE 3 — take ONLY this from the style reference: ${
      spec.refElement || "its overall mood"
    }. Everything else comes from the instructions below.`;
  }
  return "REFERENCE SCORE 1 — the style reference is context only, do not copy it.";
}

// Собирает финальный английский промпт. Правила расставлены по приоритету:
// сначала жёсткие локи (личность/объекты), потом одна идея, композиция, текст,
// цвет, стиль под ЦА, и в конце запреты — модель сильнее весит последнее.
export function buildThumbnailPrompt(
  spec: ThumbnailSpec,
  refs: PromptRef[],
  /** Площадка проекта: от неё зависит формат кадра и что вообще перекрывает превью. */
  platform: Platform = "youtube"
): string {
  const ig = platform === "instagram";
  const preset = audiencePresetById(spec.audiencePreset);
  const hasStyleRef = refs.some((r) => r.role === "style");
  const hasSpeaker = refs.some((r) => r.role === "speaker");
  const people = spec.peopleCount;

  const parts: string[] = [];

  parts.push(
    ig
      ? // ⚠️ Вертикальная обложка — не кадрированная горизонтальная. Reels-обложка
        // живёт в СЕТКЕ профиля (там её обрезают до квадрата по центру) и в ленте
        // целиком, а нижнюю часть кадра перекрывают подпись, ник и кнопки — поэтому
        // ключевое держим в верхних двух третях.
        `# ROLE
You are an art director producing an Instagram Reels cover for a Russian-language account.
Output: ONE image, 9:16 vertical, no borders, no frames, no UI, no watermark, nothing outside the frame.
The ONLY success metric is the stop-scroll rate, not beauty. It must read in under one second
while the feed is moving, and stay readable when scaled down to 220x390 px.

# VERTICAL FRAME RULES
- Keep the KEY message (main text + face) inside the TOP TWO THIRDS of the frame.
  The bottom ~20% is covered by the caption, account name and action buttons in the app.
- The profile grid crops this cover to a CENTER SQUARE: the main subject and the key
  word must survive that crop — nothing important near the top or bottom edge.
- Composition is vertical: subject fills the height, no letterboxing, no black bars,
  no horizontal 16:9 composition placed inside a vertical canvas.`
      : `# ROLE
You are an art director producing a YouTube thumbnail for a Russian-language channel.
Output: ONE image, 16:9, no borders, no frames, no UI, no watermark, nothing outside the frame.
The ONLY success metric is click-through rate, not beauty. A "designer-pretty" thumbnail that
reads slowly is a failure. Everything must be readable when the image is scaled down to 320x180 px.`
  );

  parts.push(`# INPUT IMAGES\n${refLegend(refs)}`);

  if (hasSpeaker) {
    parts.push(
      `# IDENTITY LOCK — highest priority, overrides every style instruction
Reproduce the person from the speaker reference with EXACT facial identity: same face geometry,
eye shape and spacing, nose, mouth, jawline, hairline, hairstyle, facial hair, skin tone, skin
texture, visible age, body type and weight.
Do NOT beautify, slim, de-age, smooth the skin, symmetrize the face, change ethnicity, change eye
colour, or substitute a generic model. Keep real pores and real skin. Someone who knows this person
must recognise them instantly.
You MAY change: facial expression, head angle, pose, hands, clothing, lighting, background and
camera distance. If several photos of the same person are supplied, treat them as one identity.`
    );
  }

  if (refs.some((r) => r.role === "object")) {
    parts.push(
      `# OBJECT LOCK
Objects from the object references keep their exact silhouette, proportions, colour, material and
branding. Relight them to match the scene; do not redesign, restyle or "improve" them, and do not
replace them with a generic equivalent.`
    );
  }

  const scoreLine = refScoreLine(spec, hasStyleRef);
  if (scoreLine) parts.push(`# REFERENCE SCORE\n${scoreLine}`);

  parts.push(
    `# WHAT TO SHOW — the operator's instruction, follow it literally
${spec.instructions || spec.videoSummary}`
  );

  parts.push(
    `# ONE IDEA
The thumbnail carries exactly ONE message. Every element must serve it; anything that does not add
clickability must be removed. Hand test: cover any single element — the topic must still read.`
  );

  const peopleRule =
    people === 0
      ? "There is NO person in this thumbnail. Do not invent one."
      : `Maximum ${people} human being(s) in the entire frame.${
          people === 2
            ? " If two, place them facing each other, never side by side as a crowd."
            : ""
        } NEVER add extra people as supporting elements — a second face splits attention.`;

  parts.push(
    `# COMPOSITION
- Foreground: ${
      people === 0 ? "the main object" : "the speaker"
    } plus the text. Both large, high contrast, surrounded by empty space. ${
      people === 0
        ? "The object"
        : "The speaker occupies roughly 45-55% of the frame height; the face must read at thumbnail size. A small speaker reads as low trust and kills the click"
    }.
- Midground: exactly ONE supporting element${
      spec.supportObject ? ` — ${spec.supportObject}` : ""
    }. Never more than two. It must be meaningful and triggering, not a literal illustration of a word.
- Background: context only — darker, desaturated, blurred, low contrast. It must not compete.
- Text, subject and supporting element must sit on THREE different visual scales. If they are the
  same size the eye wanders and the thumbnail dies of banner blindness.
- Depth: near = large and sharp, far = smaller and lower contrast.
- Reading direction is left to right: growth goes up to the right; "good/bad" and "before/after"
  split left/right.
- ${peopleRule}`
  );

  // Стиль — дословные раскладки от владельца (позиции спикера, текста, объекта).
  // Ставим ПОСЛЕ общей композиции и явно говорим, что он её перебивает: правила
  // выше универсальные, а тут конкретная схема кадра под выбранный вариант.
  const style = thumbStyleById(spec.style);
  const sub = thumbSubStyleById(spec.style, spec.subStyle);
  const styleText = [style.prompt, sub?.prompt].filter(Boolean).join("\n");
  if (styleText) {
    parts.push(
      `# STYLE — the exact frame layout for this thumbnail
These placements OVERRIDE the generic composition rules above wherever they disagree.
${styleText}`
    );
  }

  if (people > 0) {
    parts.push(
      `# EMOTION
${
  spec.emotion ||
  "The expression must match the topic — never a neutral passport face."
}
The emotion has to be congruent with the subject: an alarming topic gets alarm, not a smile.`
    );
  }

  const textBlock = spec.thumbText
    ? `# TEXT ON THE THUMBNAIL — render exactly
Render this exact Cyrillic text and NOTHING else. The text to render is delimited by the markers
[TEXT] and [/TEXT]. The markers themselves are NOT part of the text — do not draw them.
Render only the characters between them, verbatim:

[TEXT]${spec.thumbText}[/TEXT]

CRITICAL: do not wrap the text in quotation marks. Do NOT add quotes, guillemets («»), inverted
commas ("" or '' or „"), brackets, colons or any other punctuation that is not literally inside the
text above. If the text above contains no quote characters, the rendered image must contain no quote
characters. Do not translate, transliterate, or add or remove any word.
${
  spec.keyWord
    ? `Set the word ${spec.keyWord} (already part of the text) in CAPS at the largest size, on a colour
plate or with a thick outline behind it. The rest is smaller and unhighlighted.`
    : `Set the single most important word in CAPS at the largest size with a colour plate behind it.`
}
Rules: five words maximum. ONE typeface only — a heavy geometric sans-serif (grotesque). Two colours
maximum. Very high contrast against whatever sits behind the letters. Thick strokes; a crude heavy
outline is preferred over elegant thin type. Digits, if any, are rendered LARGE. Letters must not
overlap the face. If perfect Cyrillic rendering is not achievable, prioritise the legibility of these
exact characters over any decorative effect.`
    : `# TEXT ON THE THUMBNAIL
Do not put any text, caption, letter or digit anywhere in this image. It must be a clean image-only
thumbnail.`;
  parts.push(textBlock);

  parts.push(
    `# COLOUR
${
  spec.palette ||
  "Choose the palette from the niche and audience, not from taste. Keep the background darker so the foreground pops."
}
For comparisons use only green = good/cheap/before and red = bad/expensive/after. Never
yellow-versus-purple — viewers do not read it.`
  );

  if (preset.prompt) parts.push(`# AUDIENCE STYLE — obey literally\n${preset.prompt}`);

  const context = [
    spec.niche && `Niche: ${spec.niche}.`,
    spec.audience && `Audience: ${spec.audience}.`,
    spec.videoSummary && `The video is about: ${spec.videoSummary}`,
  ]
    .filter(Boolean)
    .join(" ");
  if (context) parts.push(`# CONTEXT\n${context}`);

  parts.push(
    `# DO NOT
- Do not reveal the video's answer or payoff. If an element would spoil it, hide it, blur it, or mark
  it with "?".
- No crowd, no "movie poster" line-up, no extra faces.
- No glossy AI look: no plastic skin, no symmetrical CGI face, no lens flares, no neon rim light on
  everything, no floating particles or fake bokeh confetti. It must look like a real photograph.
- No gibberish, mangled or half-formed letters anywhere. No Latin text at all.
- NO PUNCTUATION AT ALL in the rendered text: no full stops, commas, semicolons, colons, dashes,
  ellipses, quotation marks, brackets, and no "?", "!", "|" or "/" either. Words only. Any mark is
  visual noise at thumbnail size and steals weight from the key word.
- No YouTube interface, play button, duration badge, progress bar, border or frame.
- No thin, small or low-contrast type. No script or decorative fonts.
- The caption must sit STRICTLY HORIZONTAL on a level baseline. Do not rotate, tilt, skew, arc,
  curve, or step the text; no rising or falling baseline, no perspective, no wavy or diagonal
  layout. Every line is flat and parallel to the bottom edge of the frame. Tilted text reads as
  amateur and hurts legibility at thumbnail size.${
      spec.videoTitle
        ? `\n- HARD RULE: the thumbnail text must NEVER duplicate the video title. Do not draw the title anywhere, and do not paraphrase it. It is given only so the thumbnail avoids repeating it, delimited by markers: [TITLE]${spec.videoTitle}[/TITLE]. Title and thumbnail must say DIFFERENT things: the title carries the rational/SEO part, the thumbnail carries the emotional hook. A viewer must get two pieces of information, not the same one twice.`
        : ""
    }`
  );

  return parts.join("\n\n");
}
