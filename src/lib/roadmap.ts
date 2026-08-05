// ── Движок дорожной карты канала (чистое ядро) ─────────────────────────────
// Спека — docs/channel-roadmap.md. Чистый модуль (клиент/сервер, без prisma):
// каталог шагов, пороги диагностики, предикат «шаг актуален», гейтинг «1 шаг раз
// в 2 дня» и предикат верификации. Сервер (roadmap-server.ts) навешивает на это
// сбор сигналов из YouTube, хранение и вызов ачивок.
//
// Ключи шагов СОВПАДАЮТ с ключами ачивок-шагов (StepKey в achievements.ts): когда
// шаг переходит в done, сервер зовёт completeStep(userId, key) и загорается
// соответствующая ачивка (Заманьячить SEO / Мимо не пройдут / …).

export const ROADMAP_STEP_KEYS = [
  "step_seo",
  "step_ctr",
  "step_subs",
  "step_er",
  "step_retention",
] as const;
export type RoadmapStepKey = (typeof ROADMAP_STEP_KEYS)[number];

// Статус шага в карте.
//  locked  — ещё не открылся (гейт «1 раз в 2 дня»);
//  open    — активен, надо сделать;
//  claimed — пользователь нажал «Сделал», ждём подтверждения переразбором;
//  done    — подтверждён (сигнал улучшился или вышло новое видео).
export type RoadmapStepStatus = "locked" | "open" | "claimed" | "done";

// ── Пороги (в ОДНОМ месте, легко править) ──────────────────────────────────
// ⚠️ Часть — из методики (помечено), часть — разумные дефолты (в базе явной цифры
// нет). Меняются здесь, не разбросаны по коду.
export const ROADMAP_THRESHOLDS = {
  // SEO актуален: больше половины роликов набрали <100 просмотров. (из ТЗ)
  seoShareUnder100: 0.5,
  seoViewsFloor: 100,
  // CTR актуален: среди ЛОНГОВ доля с <1000 просмотров ≥ 40%. (из ТЗ «много
  // длинных до 1000 просмотров»)
  ctrShareLongUnder1000: 0.4,
  ctrViewsFloor: 1000,
  // Конверсия в подписку ниже правила одного процента. (из базы: «правило 1%»)
  subscribeConv: 0.01,
  // Вовлечение ER=(лайки+комменты)/просмотры ниже нормы. ⚠️ ДЕФОЛТ (в базе цифры
  // нет) — уточнить у Коли.
  engagement: 0.02,
  // Средний досмотр лонгов ниже нормы. Из ТЗ «20% — очень слабо»; берём 35% как
  // «ниже нормального».
  retentionLong: 0.35,
  // Лонгов должно быть достаточно, чтобы вывод про CTR/удержание был не по шуму.
  minLongVideos: 3,
  // Шортсом считаем ролик не длиннее 3 минут (как в диагностике канала).
  shortMaxSec: 180,
} as const;

export const ROADMAP_OPEN_INTERVAL_DAYS = 2; // новый шаг открывается раз в 2 дня

// Сигналы канала за период — то, из чего считаются условия шагов. Собирает
// сервер (fetchPeriodVideos + подписки). null у поля = данных не хватило.
export interface RoadmapSignals {
  collectedAt: string; // ISO
  videoCount: number;
  longCount: number;
  seoShareUnder100: number | null; // доля роликов с <100 просмотров, 0..1
  ctrShareLongUnder1000: number | null; // доля ЛОНГОВ с <1000 просмотров, 0..1
  engagement: number | null; // ER (лайки+комменты)/просмотры, 0..1
  retentionLong: number | null; // ср. досмотр лонгов, 0..1
  subscribeConv: number | null; // конверсия в подписку, 0..1
  maxPublishedAt: string | null; // самый свежий ролик (для «вышло новое видео»)
}

// Состояние одного шага в карте проекта (кладётся JSON-ом в ChannelRoadmap.steps).
// Статус (locked/open/claimed/done) НЕ хранится — считается из этих полей + гейта
// времени (statusOf), чтобы не держать два источника правды.
export interface RoadmapStepState {
  key: RoadmapStepKey;
  order: number; // позиция в плане (0..) — по ней считается гейт открытия
  claimedAt: string | null;
  doneAt: string | null;
  // Снимок сигналов на момент claim — с ним сравниваем при верификации.
  baseline: RoadmapSignals | null;
}

// Актуален ли шаг при таких сигналах (тот же предикат — и для отбора в план, и
// для проверки «проблема ушла»). null-сигнал = условие не проверить → не актуален.
export function stepApplies(key: RoadmapStepKey, s: RoadmapSignals): boolean {
  const t = ROADMAP_THRESHOLDS;
  switch (key) {
    case "step_seo":
      return s.seoShareUnder100 != null && s.seoShareUnder100 >= t.seoShareUnder100;
    case "step_ctr":
      return (
        s.ctrShareLongUnder1000 != null &&
        s.longCount >= t.minLongVideos &&
        s.ctrShareLongUnder1000 >= t.ctrShareLongUnder1000
      );
    case "step_subs":
      return s.subscribeConv != null && s.subscribeConv < t.subscribeConv;
    case "step_er":
      return s.engagement != null && s.engagement < t.engagement;
    case "step_retention":
      return (
        s.retentionLong != null &&
        s.longCount >= t.minLongVideos &&
        s.retentionLong < t.retentionLong
      );
    default:
      return false;
  }
}

// Фиксированный приоритет шагов (порядок дорожной карты из ТЗ).
export const ROADMAP_ORDER: RoadmapStepKey[] = [
  "step_seo",
  "step_ctr",
  "step_subs",
  "step_er",
  "step_retention",
];

// Отбор актуальных шагов в план, в порядке приоритета.
export function selectSteps(s: RoadmapSignals): RoadmapStepKey[] {
  return ROADMAP_ORDER.filter((k) => stepApplies(k, s));
}

// Сколько шагов уже «разблокировано» гейтом «1 раз в 2 дня» от старта карты.
export function unlockedCount(startedAt: Date, now: Date): number {
  const days = (now.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.floor(days / ROADMAP_OPEN_INTERVAL_DAYS) + 1);
}

// Когда откроется шаг с данным порядковым номером (для подписи «через N дней»).
export function unlockAt(startedAt: Date, order: number): Date {
  return new Date(
    startedAt.getTime() + order * ROADMAP_OPEN_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  );
}

// Вычисленный статус шага: doneAt → done; ещё не разблокирован гейтом → locked;
// заявлен (claimed) → claimed; иначе open. Гейт — «1 шаг раз в 2 дня» от старта.
export function statusOf(
  state: RoadmapStepState,
  startedAt: Date,
  now: Date
): RoadmapStepStatus {
  if (state.doneAt) return "done";
  if (state.order >= unlockedCount(startedAt, now)) return "locked";
  return state.claimedAt ? "claimed" : "open";
}

// Есть ли новое видео относительно baseline (вышел ролик после claim).
export function hasNewVideoSince(baseline: RoadmapSignals | null, cur: RoadmapSignals): boolean {
  if (!baseline?.maxPublishedAt || !cur.maxPublishedAt) return false;
  return cur.maxPublishedAt > baseline.maxPublishedAt;
}

// Подтверждён ли claim: профильный сигнал улучшился (шаг больше не актуален)
// ИЛИ вышло новое видео с момента claim. Иначе — не подтверждён (галочка отжимается).
export function isStepVerified(
  key: RoadmapStepKey,
  baseline: RoadmapSignals | null,
  cur: RoadmapSignals
): boolean {
  if (!stepApplies(key, cur)) return true; // проблема ушла
  return hasNewVideoSince(baseline, cur); // либо появилось новое видео
}

// ── Тексты для UI (в голосе продукта; методика — молча) ─────────────────────
export interface RoadmapStepMeta {
  key: RoadmapStepKey;
  title: string;
  // Почему выпал (диагноз) — коротко, по-человечески.
  why: string;
  // Что делать — конкретика.
  todo: string;
  // Куда ведёт кнопка действия: "chat" — обсудить с ассистентом; "thumbnails" —
  // в генератор превью; "youtube" — в Творческую студию; null — просто галочка.
  action: "chat" | "thumbnails" | "youtube" | null;
  actionLabel: string;
  // Подсказка ассистенту, если action==="chat" (префилл сообщения).
  chatPrompt?: string;
}

// ── Витрина для клиента ─────────────────────────────────────────────────────
export interface RoadmapStepView extends RoadmapStepMeta {
  status: RoadmapStepStatus;
  claimedAt: string | null;
  doneAt: string | null;
  // Когда откроется (ISO), если сейчас locked; иначе null.
  unlockAt: string | null;
}

export interface RoadmapView {
  startedAt: string;
  signalsAt: string | null;
  steps: RoadmapStepView[];
  doneCount: number;
  totalCount: number;
  // План пуст — по цифрам чинить нечего (канал в норме).
  allClear: boolean;
}

// Собрать витрину из сохранённых состояний шагов. Статусы и время открытия
// считаются от startedAt и now (чистая функция — время передаётся снаружи).
export function buildRoadmapView(
  states: RoadmapStepState[],
  startedAt: Date,
  signalsAt: Date | null,
  now: Date
): RoadmapView {
  const steps: RoadmapStepView[] = states.map((st) => {
    const status = statusOf(st, startedAt, now);
    return {
      ...ROADMAP_STEPS[st.key],
      status,
      claimedAt: st.claimedAt,
      doneAt: st.doneAt,
      unlockAt: status === "locked" ? unlockAt(startedAt, st.order).toISOString() : null,
    };
  });
  return {
    startedAt: startedAt.toISOString(),
    signalsAt: signalsAt ? signalsAt.toISOString() : null,
    steps,
    doneCount: steps.filter((s) => s.status === "done").length,
    totalCount: steps.length,
    allClear: steps.length === 0,
  };
}

export const ROADMAP_STEPS: Record<RoadmapStepKey, RoadmapStepMeta> = {
  step_seo: {
    key: "step_seo",
    title: "Заманьячить SEO",
    why: "Больше половины роликов набрали меньше 100 просмотров — SEO не тянет.",
    todo: "Перепиши теги, описание, название и тайм-коды по методике — новую аудиторию приведёт поиск и рекомендации.",
    action: "chat",
    actionLabel: "Разобрать SEO в чате",
    chatPrompt: "Помоги пересеошить мои ролики: теги, описание, название, тайм-коды. С чего начать?",
  },
  step_ctr: {
    key: "step_ctr",
    title: "Мимо не пройдут",
    why: "Много длинных роликов застряли до 1000 просмотров — проседает кликабельность.",
    todo: "Сначала перепроверь SEO, потом переделай превью по ВИСП и заходи на темы пошире по лестнице Ханта.",
    action: "chat",
    actionLabel: "Собрать превью и темы в чате",
    chatPrompt: "У меня слабый CTR — помоги с текстами на превью по ВИСП и с расширением тем по лестнице Ханта.",
  },
  step_subs: {
    key: "step_subs",
    title: "Правило одного процента",
    why: "Конверсия в подписку ниже 1% — смотрят, но не подписываются.",
    todo: "Ответь себе, что зритель получит, посмотрев все твои видео, и добавь в ролики недостающие призывы подписаться.",
    action: "chat",
    actionLabel: "Проработать подписку в чате",
    chatPrompt: "Низкая конверсия в подписку. Помоги с призывами подписаться и упаковкой пользы канала.",
  },
  step_er: {
    key: "step_er",
    title: "Комменты кипят",
    why: "Низкое вовлечение: мало лайков и комментариев на просмотры.",
    todo: "Добавь эмоций и прямые призывы поставить лайк и написать коммент — вовлечение алгоритм ценит.",
    action: "chat",
    actionLabel: "Поднять вовлечение в чате",
    chatPrompt: "Низкое вовлечение (лайки/комменты). Помоги придумать призывы и эмоциональные крючки в кадр.",
  },
  step_retention: {
    key: "step_retention",
    title: "Печёночный торт",
    why: "Низкое удержание — до конца досматривает мало кто.",
    todo: "Вырежи воду (можно прямо в редакторе Творческой студии) и подтяни сценарий, харизму и формат.",
    action: "youtube",
    actionLabel: "Открыть Творческую студию",
    chatPrompt: "Низкое удержание. Помоги вырезать воду и переупаковать сценарий/формат.",
  },
};
