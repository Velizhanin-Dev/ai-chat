// ── Геймификация: каталог ачивок и математика уровней ──────────────────────
// Чистый модуль (общий клиент/сервер, без prisma). Принципы и модель данных —
// docs/achievements.md. Новую ачивку добавляют СЮДА: БД и UI менять не надо.

import { THUMBNAIL_GENERATE_QUOTA_COST } from "./thumbnails";

// Счётчики действий. Инкрементятся из мест, где действие реально произошло
// (см. таблицу в docs/achievements.md), fire-and-forget.
export const COUNTER_KEYS = [
  "chat_message", // получен ответ ассистента
  "project_created", // создан проект
  "thumbnail_generated", // сгенерировано превью
  "channel_analysis", // разбор канала по 7 параметрам
  "video_analysis", // ИИ-разбор упаковки ролика
  "youtube_connected", // канал подключён
  "brief_done", // бриф + DISC пройден
  // Шаги дорожной карты канала (docs/channel-roadmap.md). Инкрементятся, когда
  // шаг ЗАСЧИТАН переразбором (галочку нельзя просто тыкнуть), а не когда нажат.
  "step_seo", // пересеошил ролики
  "step_ctr", // переделал превью / расширил темы по Ханту
  "step_subs", // добавил CTA на подписку
  "step_er", // поднял вовлечение (лайки/комменты)
  "step_retention", // подрезал воду / поднял удержание
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

// Ключи шагов карты — подмножество счётчиков. Порядок = порядок шагов у клиента.
export const STEP_KEYS = [
  "step_seo",
  "step_ctr",
  "step_subs",
  "step_er",
  "step_retention",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export function isCounterKey(v: string): v is CounterKey {
  return (COUNTER_KEYS as readonly string[]).includes(v);
}

// Производные метрики: не счётчики. streak/days_active — из дней активности,
// steps_done — сумма закрытых шагов дорожной карты.
export type DerivedKey = "streak" | "days_active" | "steps_done";
export type MetricKey = CounterKey | DerivedKey;

// Иконки — имена из @tabler/icons-react (маппинг на компоненты в UI, чтобы этот
// модуль оставался чистым и его можно было импортировать на сервере).
export type AchievementIcon =
  | "message"
  | "messages"
  | "folder"
  | "photo"
  | "radar"
  | "search"
  | "plug"
  | "user"
  | "flame"
  | "calendar"
  | "seo"
  | "click"
  | "userPlus"
  | "heart"
  | "chart"
  | "route";

export interface AchievementSpec {
  code: string;
  title: string;
  // Что надо делать. Пишем на «ты», коротко.
  description: string;
  metric: MetricKey;
  // Пороги уровней по возрастанию. Взял 10 из [1,10,50] → level=2.
  tiers: number[];
  // Звание за каждый уровень (в голосе Коли), по одному на порог tiers. Взятый
  // уровень показывает своё звание; следующее — цель. Длина = длине tiers.
  tierLabels: string[];
  icon: AchievementIcon;
  // Подпись единицы для прогресса: «12 / 50 превью».
  unit?: string;
  // Верхний порог зависит от ТАРИФА (иначе ачивка недостижима или наоборот
  // копеечная): пороги масштабируются под лимит плана, см. resolveSpec.
  //  requests   — потолок = лимит запросов тарифа (chat);
  //  projects   — потолок = лимит проектов тарифа;
  //  thumbnails — потолок = сколько превью влезает в лимит запросов (1 превью = 10).
  // 0/‑1 у лимита (безлимит/не применимо) → берём базовые tiers как есть.
  cap?: "requests" | "projects" | "thumbnails";
}

// Лимиты тарифа, от которых зависят пороги (см. Plan.limits в plans.ts).
// -1 = без ограничения, 0 = не применимо.
export interface PlanLimitsLite {
  requests: number;
  projects: number;
}

// Сколько единиц метрики реально доступно на тарифе (потолок верхнего уровня).
// <=0 → ограничения нет, оставляем базовые пороги.
export function capFor(spec: AchievementSpec, limits: PlanLimitsLite): number {
  switch (spec.cap) {
    case "requests":
      return limits.requests;
    case "projects":
      return limits.projects;
    case "thumbnails":
      // 1 генерация = THUMBNAIL_GENERATE_QUOTA_COST запросов.
      return limits.requests > 0
        ? Math.floor(limits.requests / THUMBNAIL_GENERATE_QUOTA_COST)
        : limits.requests;
    default:
      return 0;
  }
}

// Масштабирует базовые пороги под потолок тарифа, сохраняя звания. Верхний
// уровень = потолок; промежуточные — та же пропорция, что в базе. Схлопнувшиеся
// (например, при потолке 2) пороги убираются, последнему остаётся топ-звание.
function scaleTiers(
  base: number[],
  labels: string[],
  cap: number
): { tiers: number[]; tierLabels: string[] } {
  if (cap <= 0) return { tiers: base, tierLabels: labels };
  const bmax = base[base.length - 1] || 1;
  const scaled = base.map((t) => Math.max(1, Math.round((t / bmax) * cap)));
  scaled[scaled.length - 1] = cap;

  const tiers: number[] = [];
  const tierLabels: string[] = [];
  scaled.forEach((v, i) => {
    if (v > (tiers[tiers.length - 1] ?? 0)) {
      tiers.push(v);
      tierLabels.push(labels[i]);
    }
  });
  if (tiers.length === 0) {
    tiers.push(cap);
    tierLabels.push(labels[labels.length - 1]);
  }
  // Вершина всегда несёт топ-звание (даже если промежуточные схлопнулись).
  tierLabels[tierLabels.length - 1] = labels[labels.length - 1];
  return { tiers, tierLabels };
}

// Спека с порогами, подогнанными под тариф. Для ачивок без cap — без изменений.
export function resolveSpec(spec: AchievementSpec, limits: PlanLimitsLite): AchievementSpec {
  const cap = capFor(spec, limits);
  if (cap <= 0) return spec;
  const { tiers, tierLabels } = scaleTiers(spec.tiers, spec.tierLabels, cap);
  return { ...spec, tiers, tierLabels };
}

// ⚠️ Названия и описания — из ЛЕКСИКОНА Велижанина, а не нейтральные ярлыки:
// берём его дословные словечки, метафоры и присказки из базы знаний
// (knowledge-base-voice.ts: «Фирменные термины-словечки», «Меткие метафоры»;
// knowledge-base-youtube.ts / tg-closed: «правило одного процента», «печёночный
// торт», ВИСП). Мата тут нет — это речь продукта к пользователю (см. «Контракт
// голоса» в CLAUDE.md), но дерзость и рубленый стиль остаются.
// ⚠️ `code` — стабильный ключ: он лежит в UserAchievement.code. Название менять
// можно свободно, код — нельзя (иначе взятые ачивки «потеряются»).
export const ACHIEVEMENTS: AchievementSpec[] = [
  {
    code: "first_steps",
    title: "Однако здравствуйте",
    description: "Напиши ассистенту первый вопрос в чате проекта",
    metric: "chat_message",
    tiers: [1],
    tierLabels: ["Поздоровались"],
    icon: "message",
  },
  {
    code: "talker",
    title: "Маньяк",
    description: "Задавай ассистенту вопросы про свой контент — засчитывается каждый ответ (10 / 50 / 200)",
    metric: "chat_message",
    tiers: [10, 50, 200],
    tierLabels: ["Разговорился", "Прёт", "Не заткнуть"],
    icon: "messages",
    unit: "сообщений",
    cap: "requests", // потолок = лимит запросов тарифа
  },
  {
    code: "producer",
    title: "Империя",
    description: "Создавай проекты кнопкой «Новый проект» — по одному на канал (1 / 3 / 10)",
    metric: "project_created",
    tiers: [1, 3, 10],
    tierLabels: ["Первый проект", "Продюсер", "Империя"],
    icon: "folder",
    unit: "проектов",
    cap: "projects", // потолок = лимит проектов тарифа (безлимит → базовые 1/3/10)
  },
  {
    code: "packager",
    title: "Обёртка по содержимому",
    description: "Генерируй превью в разделе «Генератор превью» (1 / 10 / 50)",
    metric: "thumbnail_generated",
    tiers: [1, 10, 50],
    tierLabels: ["Первая обложка", "Упаковщик", "Обложки — разъёб"],
    icon: "photo",
    unit: "превью",
    cap: "thumbnails", // потолок = сколько превью влезает в лимит запросов (1 = 10)
  },
  {
    code: "diagnostician",
    title: "Что упало",
    description: "Жми «Разобрать канал» в разделе «Канал» — разбор по параметрам продвижения (1 / 5 / 20)",
    metric: "channel_analysis",
    tiers: [1, 5, 20],
    tierLabels: ["Заглянул под капот", "Диагност", "Насквозь видишь"],
    icon: "radar",
    unit: "разборов",
  },
  {
    code: "autopsy",
    title: "Тысяча и один раз",
    description: "Открой ролик в разделе «Канал» и жми «Разобрать видео с ИИ» (1 / 10 / 50)",
    metric: "video_analysis",
    tiers: [1, 10, 50],
    tierLabels: ["Первый разбор", "Патологоанатом", "Тысяча и один раз"],
    icon: "search",
    unit: "роликов",
  },
  {
    code: "connected",
    title: "Цифры на стол",
    description: "Подключи YouTube-канал к проекту в настройках проекта",
    metric: "youtube_connected",
    tiers: [1],
    tierLabels: ["На связи"],
    icon: "plug",
  },
  {
    code: "know_yourself",
    title: "Своя ложка",
    description: "Пройди знакомство и тест на тип харизмы при создании проекта",
    metric: "brief_done",
    tiers: [1],
    tierLabels: ["Нашёл свою ложку"],
    icon: "user",
  },
  {
    code: "streak",
    title: "Вода камень точит",
    description: "Делай хоть одно действие в продукте каждый день без пропусков (3 / 7 / 30 дней подряд)",
    metric: "streak",
    tiers: [3, 7, 30],
    tierLabels: ["Три дня в деле", "Неделя не слазишь", "Вода камень точит"],
    icon: "flame",
    unit: "дней подряд",
  },
  // ── Шаги дорожной карты канала (docs/channel-roadmap.md) ─────────────────
  // Уровень даётся, когда шаг ЗАСЧИТАН переразбором канала, а не когда нажата
  // галочка. Каждый шаг — своя ачивка (человек видит, что именно починил),
  // плюс общая «Дорожная карта» за количество закрытых шагов.
  {
    code: "step_seo",
    title: "Заманьячить SEO",
    description: "Пересеошь ролики (теги, описание, название, тайм-коды) — шаг засчитает следующий разбор канала",
    metric: "step_seo",
    tiers: [1],
    tierLabels: ["Заманьячил SEO"],
    icon: "seo",
  },
  {
    code: "step_ctr",
    title: "Мимо не пройдут",
    description: "Переделай превью по ВИСП и подними кликабельность — засчитает следующий разбор канала",
    metric: "step_ctr",
    tiers: [1],
    tierLabels: ["Мимо не проходят"],
    icon: "click",
  },
  {
    code: "step_subs",
    title: "Правило одного процента",
    description: "Добавь в ролики призывы подписаться — рост конверсии засчитает разбор канала",
    metric: "step_subs",
    tiers: [1],
    tierLabels: ["Один процент взял"],
    icon: "userPlus",
  },
  {
    code: "step_er",
    title: "Комменты кипят",
    description: "Подними лайки и комментарии призывами в кадре — засчитает следующий разбор канала",
    metric: "step_er",
    tiers: [1],
    tierLabels: ["Комменты кипят"],
    icon: "heart",
  },
  {
    code: "step_retention",
    title: "Печёночный торт",
    description: "Вырежи воду, чтобы ролики досматривали до конца — засчитает разбор канала",
    metric: "step_retention",
    tiers: [1],
    tierLabels: ["Досматривают"],
    icon: "chart",
  },
  {
    code: "roadmap",
    title: "Шаг за шагом",
    description: "Закрывай шаги дорожной карты канала по порядку (1 / 3 / 5 шагов)",
    metric: "steps_done",
    tiers: [1, 3, 5],
    tierLabels: ["Пошёл", "На середине", "Всю карту прошёл"],
    icon: "route",
    unit: "шагов",
  },
  {
    code: "regular",
    title: "Растёт то, что в фокусе",
    description: "Возвращайся в продукт в разные дни — считаются все дни с действиями (5 / 20 / 100)",
    metric: "days_active",
    tiers: [5, 20, 100],
    tierLabels: ["Заходишь", "Втянулся", "В фокусе"],
    icon: "calendar",
    unit: "дней",
  },
];

export function achievementByCode(code: string): AchievementSpec | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}

// Сколько уровней закрыто при таком значении метрики.
export function levelFor(spec: AchievementSpec, value: number): number {
  let level = 0;
  for (const tier of spec.tiers) if (value >= tier) level += 1;
  return level;
}

export const maxLevel = (spec: AchievementSpec): number => spec.tiers.length;

// Витрина одной ачивки: всё, что нужно нарисовать, посчитано на сервере.
export interface AchievementView {
  code: string;
  title: string;
  description: string;
  icon: AchievementIcon;
  unit?: string;
  value: number; // текущее значение метрики
  level: number; // взято уровней
  maxLevel: number;
  // Цель следующего уровня (null — все уровни взяты) и прогресс к ней 0..1.
  target: number | null;
  // Нижняя граница текущего отрезка: прогресс рисуем от предыдущего порога,
  // иначе на уровнях 50→200 полоса стоит почти полной и движения не видно.
  from: number;
  ratio: number;
  done: boolean;
  unlockedAt: string | null;
  // Звание текущего взятого уровня (null, пока уровень не взят) и звание
  // следующего — то, к чему идёт (null, если все уровни взяты).
  levelLabel: string | null;
  nextLabel: string | null;
  // Взят новый уровень, а пользователь его ещё не видел → метка «новое».
  fresh: boolean;
}

export interface AchievementsView {
  items: AchievementView[];
  // Сводка для карточки: сколько уровней взято из возможных + непросмотренные.
  levels: number;
  totalLevels: number;
  fresh: number;
  streak: number;
  daysActive: number;
}

export function buildView(
  spec: AchievementSpec,
  value: number,
  saved: { level: number; unlockedAt: Date | string | null; seenAt: Date | string | null } | null
): AchievementView {
  const level = Math.max(levelFor(spec, value), saved?.level ?? 0);
  const done = level >= spec.tiers.length;
  const target = done ? null : spec.tiers[level];
  const from = level > 0 ? spec.tiers[level - 1] : 0;
  const ratio = done || target === null ? 1 : clamp01((value - from) / Math.max(1, target - from));
  const unlockedAt = level > 0 ? toIso(saved?.unlockedAt ?? null) : null;
  const seenAt = saved?.seenAt ?? null;
  return {
    code: spec.code,
    title: spec.title,
    description: spec.description,
    icon: spec.icon,
    unit: spec.unit,
    value,
    level,
    maxLevel: spec.tiers.length,
    target,
    from,
    ratio,
    done,
    unlockedAt,
    levelLabel: level > 0 ? spec.tierLabels[level - 1] ?? null : null,
    nextLabel: done ? null : spec.tierLabels[level] ?? null,
    fresh: level > 0 && !seenAt,
  };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function toIso(v: Date | string | null): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}

// ── Дни активности ─────────────────────────────────────────────────────────
// День считаем по UTC-дате и на сервере, и в БД (@db.Date) — иначе серия у людей
// из разных часовых поясов разъезжается.
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Текущая серия по списку дней (в любом порядке, формат YYYY-MM-DD). Сегодня без
// действий серию ещё НЕ рвёт — рвёт пропущенный вчерашний день.
export function streakFrom(days: string[], today: string = dayKey()): number {
  const set = new Set(days);
  let cursor = today;
  // Если сегодня пусто — стартуем со вчера (день ещё не кончился).
  if (!set.has(cursor)) cursor = shiftDay(cursor, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dayKey(d);
}
