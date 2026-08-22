// ── Контекст проекта для чата: контент-план и конкуренты ─────────────────────
//
// Зачем: опорные блоки контент-плана (портреты ЦА, лестница Ханта) и списки
// конкурентов раньше жили каждый в своём разделе и НИКУДА не уходили — человек
// платил квоту за генерацию, читал один раз и закрывал вкладку. Спросить «а под
// какой сегмент этот сценарий?» или «что у конкурентов заходит по этой теме?»
// в чате было нельзя: ассистент про них не знал вовсе.
//
// ⚠️ Всё берётся ТОЛЬКО из БД — ни одного вызова YouTube API. Оба раздела уже
// сложили туда свои данные (план — при генерации, конкуренты — снимками карточек
// и сохранённой выдачей поиска), поэтому контекст чата не стоит ни units, ни
// денег и не зависит от того, жив ли пул ключей.
//
// ⚠️ Блоки идут в НЕкэшируемый хвост промпта (как снимок канала): они пер-проектные
// и меняются, кэш-префикс ими ломать нельзя.

import { prisma } from "./prisma";
import {
  aggregateChannels,
  formatRatio,
  sanitizeFilters,
  type CompetitorChannel,
  type CompetitorResult,
} from "./competitors";
import { cachedTrackedFeed } from "./competitors-server";
import type { HuntStep, Persona } from "./content-plan";

// Потолки: контекст должен помещаться рядом с методикой и брифом, а не вытеснять
// их. Цифры подобраны так, чтобы оба блока вместе укладывались в ~2–3k токенов.
const MAX_PLAN_VIDEOS = 12;
const MAX_PLAN_SHORTS = 16;
const MAX_PERSONAS = 5;
const MAX_HUNT_STEPS = 5;
const MAX_TRACKED = 12;
const MAX_NICHE_CHANNELS = 8;
const MAX_HOT_VIDEOS = 8;
const MAX_FRESH_VIDEOS = 6;
// Порог «залетел» для свежих роликов конкурентов. Выше дефолтного фильтра раздела
// (×3): в контекст чата попадает только то, что реально выстрелило, а не любая
// новинка — иначе список превращается в ленту публикаций и вытесняет полезное.
const FRESH_MIN_RATIO = 3;

// Сохранённая выдача поиска старше этого срока в контекст не идёт: цифры
// конкурентов протухают, а «×12 полгода назад» ассистент подаст как «сейчас».
const SEARCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

// Прирост подписчиков за неделю по нашим снимкам. Своя копия расчёта из
// competitors-server (там он приватный и живёт внутри загрузки ленты, которая
// ходит в YouTube — а нам нужен только счёт по уже накопленным строкам).
// ⚠️ Окно — 7 дней от последнего снимка, а не вся история: иначе через полгода
// цифра станет средним за полгода. Меньше двух снимков — null («копим»), НЕ ноль:
// ноль читается как «канал не растёт», хотя мы просто ещё не знаем.
function weeklyGrowth(
  history: Array<{ day: Date; subscribers: number }>
): { subsPerWeek: number | null; spanDays: number } {
  if (history.length < 2) return { subsPerWeek: null, spanDays: history.length };
  const last = history[history.length - 1];
  const weekAgo = last.day.getTime() - 7 * DAY_MS;
  let base = history[0];
  for (const point of history) {
    if (point === last) break;
    if (point.day.getTime() <= weekAgo) base = point;
  }
  const spanDays = Math.round((last.day.getTime() - base.day.getTime()) / DAY_MS);
  if (spanDays <= 0) return { subsPerWeek: null, spanDays: 1 };
  const totalSpan = Math.round(
    (last.day.getTime() - history[0].day.getTime()) / DAY_MS
  );
  return {
    subsPerWeek: Math.round(((last.subscribers - base.subscribers) / spanDays) * 7),
    spanDays: Math.max(totalSpan, 1),
  };
}

function num(n: number): string {
  return n.toLocaleString("ru-RU");
}

function clean(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

const STATUS_WORD: Record<string, string> = {
  idea: "идея",
  in_progress: "в работе",
  published: "опубликован",
  cancelled: "отменён",
};

// ── Контент-план проекта ─────────────────────────────────────────────────────
export async function buildPlanContextBlock(
  conversationId: string
): Promise<string | null> {
  const plan = await prisma.contentPlan.findFirst({
    where: { conversationId },
    orderBy: { period: "desc" },
    select: {
      label: true,
      niche: true,
      audience: true,
      huntLadder: true,
      videos: {
        orderBy: { order: "asc" },
        select: {
          kind: true,
          status: true,
          titles: true,
          previewTexts: true,
          format: true,
          huntStage: true,
          pain: true,
          views: true,
        },
      },
    },
  });
  if (!plan) return null;

  const personas = (Array.isArray(plan.audience) ? plan.audience : []) as unknown as Persona[];
  const hunt = (Array.isArray(plan.huntLadder) ? plan.huntLadder : []) as unknown as HuntStep[];
  const longs = plan.videos.filter((v) => v.kind !== "short");
  const shorts = plan.videos.filter((v) => v.kind === "short");
  // Пустая заготовка без единой строки и без блоков — не засоряем промпт
  // заголовком ради заголовка.
  if (!longs.length && !shorts.length && !personas.length && !hunt.length) return null;

  const lines: string[] = [
    "# КОНТЕНТ-ПЛАН ПРОЕКТА (раздел «Контент-план» в приложении)",
    "Это его рабочая сетка роликов и опорные блоки под неё. Когда вопрос касается тем, сценариев, названий, ЦА или «что снимать дальше» — опирайся на ЭТО, а не на общие рассуждения: сегменты и боли тут уже собраны под его нишу. Новую идею проверяй на повтор с тем, что уже в плане. Предложил тему — можешь по-человечески подсказать, что карточку он заводит на доске в разделе «Контент-план». НЕ пересказывай план целиком без запроса и не выводи его таблицей — держи в уме и ссылайся по делу.",
    "",
    `План: ${clean(plan.label, 60)}${plan.niche ? ` · ниша: ${clean(plan.niche, 200)}` : ""}.`,
  ];

  if (longs.length) {
    lines.push("", `Ролики в плане (${longs.length}):`);
    for (const v of longs.slice(0, MAX_PLAN_VIDEOS)) {
      const title = clean(v.titles?.[0], 160) || "без названия";
      const bits = [STATUS_WORD[v.status] ?? v.status];
      if (v.format) bits.push(clean(v.format, 40));
      if (v.views != null) bits.push(`${num(v.views)} просмотров`);
      const pain = clean(v.pain, 160);
      const preview = clean(v.previewTexts?.[0], 80);
      lines.push(
        `- ${title} (${bits.join(", ")})` +
          (preview ? ` · на превью: «${preview}»` : "") +
          (pain ? ` · боль: ${pain}` : "")
      );
    }
    if (longs.length > MAX_PLAN_VIDEOS) {
      lines.push(`- …и ещё ${longs.length - MAX_PLAN_VIDEOS} — они есть на доске.`);
    }
  }

  if (shorts.length) {
    const titles = shorts
      .slice(0, MAX_PLAN_SHORTS)
      .map((v) => clean(v.titles?.[0], 120) || "без названия");
    lines.push("", `Шортсы в плане (${shorts.length}): ${titles.join(" · ")}`);
  }

  if (personas.length) {
    lines.push(
      "",
      "Портреты ЦА (собраны под этот канал — пиши сценарии и хуки ПОД НИХ, боли бери отсюда, а не выдумывай):"
    );
    for (const p of personas.slice(0, MAX_PERSONAS)) {
      const pains = Array.isArray(p.pains)
        ? p.pains.map((x) => clean(x, 160)).filter(Boolean).slice(0, 5)
        : [];
      lines.push(
        `- ${clean(p.name, 80) || "сегмент"} — ${clean(p.who, 240)}` +
          (p.huntStage ? ` · стадия Ханта: ${clean(p.huntStage, 120)}` : "")
      );
      if (pains.length) lines.push(`  боли от 1 лица: ${pains.join(" | ")}`);
      const off = clean(p.turnOff, 200);
      if (off) lines.push(`  оттолкнёт: ${off}`);
    }
  }

  if (hunt.length) {
    lines.push(
      "",
      "Лестница Ханта под его нишу (на какой стадии зритель и что ему заходит):"
    );
    for (const s of hunt.slice(0, MAX_HUNT_STEPS)) {
      const topics = Array.isArray(s.topics)
        ? s.topics.map((x) => clean(x, 120)).filter(Boolean).slice(0, 4)
        : [];
      const thoughts = Array.isArray(s.thoughts)
        ? s.thoughts.map((x) => clean(x, 140)).filter(Boolean).slice(0, 3)
        : [];
      lines.push(
        `- ${clean(s.stage, 100) || "ступень"} — ${clean(s.state, 240)}` +
          (s.content ? ` · что заходит: ${clean(s.content, 200)}` : "")
      );
      if (thoughts.length) lines.push(`  внутренние диалоги: ${thoughts.join(" | ")}`);
      if (topics.length) lines.push(`  темы-зацепки: ${topics.join(" · ")}`);
    }
  }

  return lines.join("\n");
}

// ── Конкуренты в нише ────────────────────────────────────────────────────────
export async function buildCompetitorsContextBlock(
  conversationId: string
): Promise<string | null> {
  const [tracked, searchRow] = await Promise.all([
    prisma.trackedChannel.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: MAX_TRACKED,
      select: {
        title: true,
        subscribers: true,
        stats: {
          orderBy: { day: "asc" },
          select: { day: true, subscribers: true },
        },
      },
    }),
    prisma.competitorSearch.findFirst({
      where: { conversationId },
      orderBy: { updatedAt: "desc" },
      select: { result: true, updatedAt: true },
    }),
  ]);

  const search =
    searchRow && Date.now() - searchRow.updatedAt.getTime() < SEARCH_MAX_AGE_MS
      ? (searchRow.result as unknown as CompetitorResult | null)
      : null;
  const videos = Array.isArray(search?.videos) ? (search as CompetitorResult).videos : [];
  const niche: CompetitorChannel[] = videos.length
    ? aggregateChannels(videos, sanitizeFilters(undefined))
    : [];

  // Свежие залетевшие ролики ИЗ ЕГО СПИСКА конкурентов — из кэша ленты «Новинки».
  // ⚠️ Только память: за ленту платят units, и делать это на каждое сообщение чата
  // нельзя. Нет кэша — просто нет этой части (см. cachedTrackedFeed).
  const feed = cachedTrackedFeed(conversationId);
  const fresh = (feed?.videos ?? [])
    .filter((v) => v.ratio >= FRESH_MIN_RATIO)
    .slice(0, MAX_FRESH_VIDEOS);

  if (!tracked.length && !videos.length && !fresh.length) return null;

  const lines: string[] = [
    "# КОНКУРЕНТЫ В ЕГО НИШЕ (разделы «Конкуренты» и «Поиск референсов»)",
    "Реальные каналы и залетевшие ролики из его ниши — с кратностью «просмотров к подписчикам»: во сколько раз ролик вылетел за свою аудиторию. Высокая кратность = сработала УПАКОВКА (название, превью, тема), и это то, что имеет смысл разбирать. Когда речь про темы, названия, превью или «почему у них заходит, а у меня нет» — опирайся на эту конкретику, а не на абстрактные примеры.",
    "⚠️ Копировать чужие названия и темы НЕЛЬЗЯ (прямой запрет методики) — разбирай МЕХАНИКУ (на какую боль бьют, каким триггером цепляют) и собирай своё под его канал. У свежих роликов кратность занижена — они ещё набирают.",
  ];

  if (tracked.length) {
    lines.push("", "Каналы, за которыми он следит (его список конкурентов):");
    for (const t of tracked) {
      const g = weeklyGrowth(t.stats);
      const growth =
        g.subsPerWeek != null
          ? `${g.subsPerWeek >= 0 ? "+" : "−"}${num(Math.abs(g.subsPerWeek))} подписчиков в неделю`
          : `динамику ещё копим (${g.spanDays} дн.)`;
      lines.push(`- ${clean(t.title, 100)} — ${num(t.subscribers)} подписчиков, ${growth}`);
    }
  }

  if (niche.length) {
    lines.push("", "Каналы ниши из поиска (сколько их роликов выстрелило):");
    for (const c of niche.slice(0, MAX_NICHE_CHANNELS)) {
      const top = c.topVideo
        ? ` · лучший: «${clean(c.topVideo.title, 140)}» ${formatRatio(c.topVideo.ratio)}`
        : "";
      lines.push(
        `- ${clean(c.title, 100)} — ${num(c.subscribers)} подписчиков, выстрелило роликов: ${c.hits}, медиана ${formatRatio(c.medianRatio)}${top}`
      );
    }
  }

  if (fresh.length) {
    lines.push(
      "",
      `Свежие ролики его конкурентов, которые уже залетели (за последние ${feed?.days ?? 7} дн.):`
    );
    for (const v of fresh) {
      lines.push(
        `- «${clean(v.title, 160)}» — ${formatRatio(v.ratio)}, ${num(v.views)} просмотров, ${clean(v.channelTitle, 80)}${v.isShort ? " [шортс]" : ""}`
      );
    }
    lines.push(
      "Это самое горячее в нише прямо сейчас: если он спрашивает «что снимать» или «что у них заходит» — отталкивайся отсюда, но собирай СВОЮ тему на их механике."
    );
  }

  const hot = [...videos].sort((a, b) => b.ratio - a.ratio).slice(0, MAX_HOT_VIDEOS);
  if (hot.length) {
    lines.push("", "Залетевшие ролики ниши (название — кратность — просмотры — канал):");
    for (const v of hot) {
      lines.push(
        `- «${clean(v.title, 160)}» — ${formatRatio(v.ratio)}, ${num(v.views)} просмотров, ${clean(v.channelTitle, 80)} (${num(v.subscribers)} подписчиков)${v.isShort ? " [шортс]" : ""}`
      );
    }
    const fetched = search?.fetchedAt ? new Date(search.fetchedAt) : null;
    if (fetched && !Number.isNaN(fetched.getTime())) {
      const queries = (search?.queries ?? []).map((q) => clean(q, 60)).filter(Boolean);
      lines.push(
        "",
        `Выдача собрана ${fetched.toLocaleDateString("ru-RU")}${
          queries.length ? ` по запросам: ${queries.join(", ")}` : ""
        }. Цифры с тех пор могли вырасти.`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Оба блока разом. Best-effort: сбой любого — чат не роняем, просто отвечаем без
 * этой части контекста (как со снимком канала).
 */
export async function resolveProjectContext(conversationId: string): Promise<string[]> {
  const [plan, competitors] = await Promise.all([
    buildPlanContextBlock(conversationId).catch((err) => {
      console.error("[chat] plan context error:", err);
      return null;
    }),
    buildCompetitorsContextBlock(conversationId).catch((err) => {
      console.error("[chat] competitors context error:", err);
      return null;
    }),
  ]);
  return [plan, competitors].filter((b): b is string => Boolean(b));
}
