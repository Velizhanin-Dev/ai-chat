import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getStrategy } from "./llm";
import { buildSystem, buildChannelBlock } from "./llm/system";
import { getChannelSnapshotCached } from "./youtube";
import { getSettings } from "./settings";
import { routeQuery } from "./router";
import type { RouteDecision } from "./router";
import {
  sanitizeBrief,
  isBriefComplete,
  briefSearchTerms,
  withBriefTerms,
  type Brief,
} from "./brief";
import {
  MAX_VIDEO_COUNT,
  type Cta,
  type Visp,
  type VideoView,
  type ContentPlanView,
} from "./content-plan";

// ── Контент-план: генерация по методике (серверная часть) ──────────────────
// docs/content-plan.md. LLM собирает месячную сетку роликов (CONTENT_PLAN_GUIDE),
// возвращает строгий JSON, мы нормализуем под модель. Гейт/квота/запись — в роуте.

// Нормализованный ролик из ответа модели (перед записью в БД).
export interface GenVideo {
  kind: "video" | "short";
  titles: string[];
  previewTexts: string[];
  format: string | null;
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
}

const FORMAT_MAP: Record<string, "reach" | "expert" | "selling"> = {
  reach: "reach",
  охватное: "reach",
  expert: "expert",
  экспертное: "expert",
  selling: "selling",
  продающее: "selling",
};

function strArr(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, max)
    : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Достаём массив роликов из ответа модели (может прийти в ```json / с текстом).
export function extractVideos(text: string): GenVideo[] {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  // Берём либо объект { videos: [...] }, либо голый массив [...].
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t.slice(start, end + 1));
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { videos?: unknown }).videos)
      ? (parsed as { videos: unknown[] }).videos
      : [];

  const out: GenVideo[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const titles = strArr(o.titles ?? o.title, 3);
    if (titles.length === 0) continue;
    const fmtRaw = str(o.format)?.toLowerCase() ?? "";
    const ctaObj = (o.cta ?? {}) as Record<string, unknown>;
    const vispObj = (o.visp ?? {}) as Record<string, unknown>;
    out.push({
      kind: str(o.kind) === "short" ? "short" : "video",
      titles,
      previewTexts: strArr(o.previewTexts ?? o.preview, 3),
      format: FORMAT_MAP[fmtRaw] ?? null,
      noSpeaker: Boolean(o.noSpeaker),
      huntStage: str(o.huntStage),
      pain: str(o.pain),
      questions: strArr(o.questions, 10),
      nativeClose: str(o.nativeClose),
      cta: {
        like: str(ctaObj.like) ?? undefined,
        subscribe: str(ctaObj.subscribe) ?? undefined,
        comment: str(ctaObj.comment) ?? undefined,
        link: str(ctaObj.link) ?? undefined,
        leadMagnet: str(ctaObj.leadMagnet) ?? undefined,
      },
      visp: {
        v: Boolean(vispObj.v),
        i: Boolean(vispObj.i),
        s: Boolean(vispObj.s),
        p: Boolean(vispObj.p),
      },
      reference: str(o.reference),
      whyWorks: str(o.whyWorks),
      opening: str(o.opening),
    });
  }
  return out;
}

const JSON_FORMAT_BLOCK = `# ФОРМАТ ЭТОЙ ЗАДАЧИ (строго)
Это не чат, а генерация контент-плана. Верни ТОЛЬКО валидный JSON — объект вида {"videos":[ ... ]}, без markdown-обёртки, без преамбул и текста вокруг.
Каждый элемент videos[] — один ролик со ВСЕМИ полями (ключи латиницей, значения по-русски, в моём стиле кликбейта и методике):
{
  "titles": ["вариант названия 1", "вариант 2"],           // 2–3 варианта, кликбейт по ВИСП
  "previewTexts": ["текст на превью 1", "вариант 2"],       // 2–4 слова, НЕ повтор названия
  "format": "reach" | "expert" | "selling",                // охватное / экспертное / продающее
  "noSpeaker": true|false,                                   // подтип «охватное без спикера» (озвучка чужого видео)
  "huntStage": "стадия лестницы Ханта словами",
  "pain": "боль ЦА от ПЕРВОГО лица (— боюсь…, — хочу…)",
  "questions": ["10 вопросов-скелет ролика"],                // РОВНО 10, по нарастанию
  "nativeClose": "на что мягко закрываем",
  "cta": {"like":"…","subscribe":"…","comment":"…","link":"…","leadMagnet":"…"},
  "visp": {"v":true,"i":true,"s":false,"p":true},            // какие буквы ВИСП зажёг заголовок
  "reference": "видео-донор: что искать (ссылки не выдумывай)",
  "whyWorks": "почему тема залетит — универсальный страх/желание",
  "opening": "прописанный опенинг (первый крючок), если формат мотивационный/новостной — иначе пустая строка"
}
Баланс за месяц: БОЛЬШИНСТВО роликов reach (растим канал), часть expert. Не выдумывай реальные новости/цифры/имена/ссылки. 10 вопросов — обязательно.`;

// Снимок канала проекта для промпта генерации. Best-effort: нет интеграции, протух
// токен, молчит YouTube — возвращаем null и генерируем без него (генерацию не роняем).
async function resolveChannelBlock(projectId: string): Promise<string | null> {
  try {
    const integ = await prisma.youTubeIntegration.findUnique({
      where: { conversationId: projectId },
    });
    if (!integ) return null;
    const snap = await getChannelSnapshotCached(projectId, integ);
    return snap ? buildChannelBlock(snap) : null;
  } catch {
    return null;
  }
}

// Сгенерировать сетку роликов. Возвращает нормализованные ролики (throws на сбое
// LLM). Гейт/квота/запись — в роуте (/api/content-plan/generate).
export async function generatePlanVideos(opts: {
  userId: string;
  projectId: string;
  brief: Brief | null;
  count: number;
  periodLabel: string;
}): Promise<GenVideo[]> {
  const { userId, projectId, brief, count, periodLabel } = opts;
  const settings = await getSettings();
  const provider = settings.provider;

  // ⚠️ Хинт роутера СОБИРАЕТСЯ ИЗ БРИФА, а не берётся константой.
  // Раньше тут была захардкоженная строка, и она же уходила в BM25-ретрив. Ретрив —
  // чистая функция от запроса, поэтому психолог, строитель и автосервис получали из
  // базы ПОБАЙТОВО ОДИНАКОВЫЕ куски: из 15 нишевых шпаргалок раздела «Нишевые боли и
  // рабочие темы» стабильно доезжали одни и те же три (авто, финансы, недвижимость).
  // Отсюда и «идеи средние по интернету» — фактура у всех была общая.
  const planTerms =
    "контент-план сетка роликов названия превью формат боль ца 10 вопросов лестница ханта cta висп";
  const routeHint = [briefSearchTerms(brief), planTerms].filter(Boolean).join(" ");
  const route: RouteDecision = await routeQuery(
    [{ role: "user", content: routeHint }],
    provider,
    { userId, conversationId: projectId }
  );
  // Гарантируем набор слоёв под контент-план (не полагаемся на классификатор).
  route.category = "content_plan";
  route.contentPlan = true;
  route.tgClosed = true;
  route.book = true;
  route.youtube = true;

  // Снимок канала — фактура, которой нет ни у кого, кроме нас: что у клиента реально
  // залетало и что провалилось. Best-effort: канал не подключён или YouTube молчит —
  // генерируем как раньше.
  const channelBlock = await resolveChannelBlock(projectId);

  const systemBlocks = buildSystem(
    route,
    withBriefTerms(route.searchQuery || routeHint, brief),
    "",
    brief,
    "",
    channelBlock
  );
  systemBlocks.push({ type: "text", text: JSON_FORMAT_BLOCK });

  const genPrompt = `Собери контент-план на «${periodLabel}»: ровно ${count} роликов (лонгов) по моей методике. Ниша/аудитория/продукт — из брифа проекта (если чего-то нет — работай от ниши).${
    channelBlock
      ? " У тебя выше есть данные его канала — оттолкнись от формы того, что там уже ЗАЛЕТЕЛО, и не повторяй темы, которые уже выходили."
      : ""
  } Верни строго JSON {"videos":[...]} по схеме из system.`;

  const strategy = getStrategy(provider);
  let full = "";
  for await (const token of strategy.stream({
    system: systemBlocks,
    messages: [{ role: "user", content: genPrompt }],
    route,
    routeMs: 0,
    model: settings.openrouterModel,
    orParams: settings.openrouterParams,
    orProvider: settings.openrouterProvider,
    meta: { userId, conversationId: projectId },
  })) {
    full += token;
  }

  const videos = extractVideos(full);
  return videos.slice(0, MAX_VIDEO_COUNT);
}

// ── Опорные блоки (Фаза 3): портреты ЦА / лестница Ханта / воронка / шортсы ──
import type { BlockKey, Funnel, HuntStep, Persona } from "./content-plan";
import { DEFAULT_SHORTS_COUNT } from "./content-plan";

const BLOCK_INSTRUCTION: Record<BlockKey, string> = {
  audience: `Собери 3–4 портрета ЦА канала. Верни JSON {"audience":[{"name":"короткое имя сегмента","who":"кто это: возраст/роль, кто платит vs кто пользуется","huntStage":"стадия лестницы Ханта словами","pains":["боли ОТ ПЕРВОГО ЛИЦА: — боюсь…, — хочу…"],"turnOff":"что оттолкнёт этот сегмент (например, молодёжный кликбейт для премиум-ЦА)"}]}.`,
  hunt: `Разложи лестницу Ханта под нишу канала — 5 ступеней. Верни JSON {"hunt":[{"stage":"название ступени словами","state":"состояние клиента","thoughts":["внутренние диалоги дословно, от 1 лица"],"content":"какой контент на этой ступени работает","topics":["2–4 темы-зацепки"]}]}.`,
  shorts: `Собери лёгкую сетку из ${DEFAULT_SHORTS_COUNT} шортсов. Верни JSON {"shorts":[{"titles":["название//тема шортса"],"previewTexts":["текст на превью, 2–3 слова"],"opening":"первая фраза-крючок (заход)","reference":"какой ролик-донор искать","pain":"боль ЦА от первого лица"}]}. Шортсы — верх воронки и холодный охват: нарезки, реакции, тесты со своим заходом.`,
};

// Сгенерировать опорный блок. Возвращает сырой распарсенный объект нужной формы
// (throws на сбое LLM). Гейт/квота/запись — в роуте.
export async function generateBlock(opts: {
  userId: string;
  projectId: string;
  brief: Brief | null;
  block: BlockKey;
}): Promise<{
  audience?: Persona[];
  hunt?: HuntStep[];
  funnel?: Funnel;
  shorts?: GenVideo[];
}> {
  const { userId, projectId, brief, block } = opts;
  const settings = await getSettings();
  const provider = settings.provider;

  const routeHint =
    "контент-план опорные блоки: портреты ца боли лестница ханта воронка шортсы хук референс";
  const route: RouteDecision = await routeQuery(
    [{ role: "user", content: routeHint }],
    provider,
    { userId, conversationId: projectId }
  );
  // Опорные блоки — часть методики контент-плана: эталон подключаем, книгу нет
  // (лишний объём), ВИСП/превью-слой оставляем.
  route.category = "chat"; // без thinking — это структурная выжимка, не артефакт
  route.contentPlan = true;
  route.tgClosed = true;
  route.book = false;
  route.formats = false;
  route.youtube = block === "shorts"; // слой шортсов пригодится только тут

  const systemBlocks = buildSystem(route, withBriefTerms(route.searchQuery || routeHint, brief), "", brief, "");
  systemBlocks.push({
    type: "text",
    text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (строго)\nВерни ТОЛЬКО валидный JSON без markdown-обёртки и текста вокруг. Значения — по-русски, в моём стиле. Ниша/аудитория — из брифа проекта.`,
  });

  const strategy = getStrategy(provider);
  let full = "";
  for await (const token of strategy.stream({
    system: systemBlocks,
    messages: [{ role: "user", content: BLOCK_INSTRUCTION[block] }],
    route,
    routeMs: 0,
    model: settings.openrouterModel,
    orParams: settings.openrouterParams,
    orProvider: settings.openrouterProvider,
    meta: { userId, conversationId: projectId },
  })) {
    full += token;
  }

  // Шортсы разбираем тем же нормализатором строк ролика.
  if (block === "shorts") {
    const arr = extractVideos(full.replace(/"shorts"\s*:/, '"videos":'));
    return { shorts: arr.map((v) => ({ ...v, kind: "short" as const })) };
  }

  let t = full.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return {};
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }

  if (block === "audience") {
    const raw = Array.isArray(o.audience) ? o.audience : [];
    const audience: Persona[] = raw.slice(0, 5).flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const p = x as Record<string, unknown>;
      const name = str(p.name);
      if (!name) return [];
      return [
        {
          name,
          who: str(p.who) ?? "",
          huntStage: str(p.huntStage) ?? "",
          pains: strArr(p.pains, 6),
          turnOff: str(p.turnOff) ?? "",
        },
      ];
    });
    return { audience };
  }

  if (block === "hunt") {
    const raw = Array.isArray(o.hunt) ? o.hunt : [];
    const hunt: HuntStep[] = raw.slice(0, 5).flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const h = x as Record<string, unknown>;
      const stage = str(h.stage);
      if (!stage) return [];
      return [
        {
          stage,
          state: str(h.state) ?? "",
          thoughts: strArr(h.thoughts, 5),
          content: str(h.content) ?? "",
          topics: strArr(h.topics, 5),
        },
      ];
    });
    return { hunt };
  }

  // funnel
  const f = (o.funnel ?? {}) as Record<string, unknown>;
  const rawParts = Array.isArray(f.parts) ? f.parts : [];
  const parts = rawParts.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const p = x as Record<string, unknown>;
    const fmt = FORMAT_MAP[str(p.format)?.toLowerCase() ?? ""];
    const share = Number(p.share);
    if (!fmt || !Number.isFinite(share)) return [];
    return [{ format: fmt, share: Math.min(1, Math.max(0, share)), goal: str(p.goal) ?? "" }];
  });
  if (parts.length === 0) return {};
  return { funnel: { parts, note: str(f.note) ?? "" } };
}

// ── Ресинк просмотров у привязанных роликов ─────────────────────────────────
// Просмотры на карточке — снимок на момент привязки. Обновляем их из свежего
// списка видео канала (тот же кэш, что у пикера): дёшево и не трогает YouTube на
// каждый чих. Возвращает, сколько строк обновилось.
export async function resyncPlanViews(
  planId: string,
  videos: { id: string; thumbnail: string | null; views: number }[]
): Promise<number> {
  if (videos.length === 0) return 0;
  const byId = new Map(videos.map((v) => [v.id, v]));
  const linked = await prisma.contentPlanVideo.findMany({
    where: { planId, youtubeVideoId: { not: null } },
    select: { id: true, youtubeVideoId: true, views: true, thumbnail: true },
  });
  let updated = 0;
  for (const row of linked) {
    const fresh = byId.get(row.youtubeVideoId ?? "");
    if (!fresh) continue;
    if (fresh.views === row.views && (fresh.thumbnail ?? null) === row.thumbnail) continue;
    await prisma.contentPlanVideo.update({
      where: { id: row.id },
      data: { views: fresh.views, thumbnail: fresh.thumbnail ?? null },
    });
    updated += 1;
  }
  return updated;
}

// ── Проверка владения (план/ролик принадлежат проекту юзера) ────────────────
export async function planConversation(userId: string, planId: string): Promise<string | null> {
  const plan = await prisma.contentPlan.findFirst({
    where: { id: planId, conversation: { userId } },
    select: { conversationId: true },
  });
  return plan?.conversationId ?? null;
}

export async function videoPlanId(userId: string, videoId: string): Promise<string | null> {
  const v = await prisma.contentPlanVideo.findFirst({
    where: { id: videoId, plan: { conversation: { userId } } },
    select: { planId: true },
  });
  return v?.planId ?? null;
}

// ── Переделка части карточки ИИ (1 запрос) ─────────────────────────────────
import type { RegenPart } from "./content-plan";

const REGEN_INSTRUCTION: Record<RegenPart, string> = {
  titles:
    'Дай 3 НОВЫХ варианта названия ролика по ВИСП (кликбейт, конкретика/цифра/интрига). Верни JSON {"titles":["…","…","…"]}.',
  previewTexts:
    'Дай 3 НОВЫХ варианта текста НА превью (2–4 слова, бьёт в эмоцию, НЕ повтор названия). Верни JSON {"previewTexts":["…","…","…"]}.',
  questions:
    'Перепиши скелет ролика — РОВНО 10 вопросов/тезисов по нарастанию (от захода к сути и «что делать»). Верни JSON {"questions":["…", … 10 штук]}.',
  format:
    'Предложи формат под цель в воронке (reach/expert/selling) и, если это охватное без спикера, поставь noSpeaker=true. Верни JSON {"format":"reach|expert|selling","noSpeaker":true|false}.',
};

// Переделать одну часть карточки. Возвращает частичные поля (throws на сбое LLM).
// Гейт/квота/запись — в роуте (/api/content-plan/video/[id]/regenerate).
export async function regenerateVideoPart(opts: {
  userId: string;
  projectId: string;
  brief: Brief | null;
  part: RegenPart;
  video: { titles: string[]; pain: string | null; huntStage: string | null; format: string | null };
}): Promise<Partial<{ titles: string[]; previewTexts: string[]; questions: string[]; format: string | null; noSpeaker: boolean }>> {
  const { userId, projectId, brief, part, video } = opts;
  const settings = await getSettings();
  const provider = settings.provider;

  const routeHint =
    "переделай часть контент-плана по методике: название превью 10 вопросов формат по висп и лестнице ханта";
  const route: RouteDecision = await routeQuery(
    [{ role: "user", content: routeHint }],
    provider,
    { userId, conversationId: projectId }
  );
  // Тюним под лёгкую задачу (как ИИ-разбор видео): без thinking, книга/форматы off,
  // слой ВИСП/превью (tgClosed) on.
  route.category = "chat";
  route.contentPlan = false;
  route.book = false;
  route.formats = false;
  route.tgClosed = true;
  route.youtube = false;

  const systemBlocks = buildSystem(route, withBriefTerms(route.searchQuery || routeHint, brief), "", brief, "");
  systemBlocks.push({
    type: "text",
    text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (строго)\nЭто не чат, а переделка части контент-плана. Верни ТОЛЬКО валидный JSON без markdown и текста вокруг.`,
  });

  const ctx = `Ролик контент-плана. Текущее название: «${video.titles[0] ?? "—"}». Боль ЦА: ${video.pain ?? "—"}. Стадия Ханта: ${video.huntStage ?? "—"}. Текущий формат: ${video.format ?? "—"}. Ниша/аудитория — из брифа.`;
  const genPrompt = `${ctx}\n\n${REGEN_INSTRUCTION[part]}`;

  const strategy = getStrategy(provider);
  let full = "";
  for await (const token of strategy.stream({
    system: systemBlocks,
    messages: [{ role: "user", content: genPrompt }],
    route,
    routeMs: 0,
    model: settings.openrouterModel,
    orParams: settings.openrouterParams,
    orProvider: settings.openrouterProvider,
    meta: { userId, conversationId: projectId },
  })) {
    full += token;
  }

  let t = full.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return {};
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }

  if (part === "titles") return { titles: strArr(o.titles, 3) };
  if (part === "previewTexts") return { previewTexts: strArr(o.previewTexts, 3) };
  if (part === "questions") return { questions: strArr(o.questions, 10) };
  if (part === "format") {
    const f = str(o.format)?.toLowerCase() ?? "";
    return { format: FORMAT_MAP[f] ?? null, noSpeaker: Boolean(o.noSpeaker) };
  }
  return {};
}

// Бриф проекта → Brief | null (как в analyze route).
export function briefFromJson(v: Prisma.JsonValue | null | undefined): Brief | null {
  const b = sanitizeBrief(v);
  return isBriefComplete(b) ? b : null;
}

// ── Мапперы БД → витрина ────────────────────────────────────────────────────
type VideoRow = {
  id: string;
  order: number;
  kind: string;
  status: string;
  source: string;
  titles: string[];
  previewTexts: string[];
  format: string | null;
  noSpeaker: boolean;
  huntStage: string | null;
  pain: string | null;
  questions: string[];
  nativeClose: string | null;
  cta: Prisma.JsonValue | null;
  visp: Prisma.JsonValue | null;
  reference: string | null;
  whyWorks: string | null;
  opening: string | null;
  youtubeVideoId: string | null;
  thumbnail: string | null;
  views: number | null;
};

export function toVideoView(r: VideoRow): VideoView {
  return {
    id: r.id,
    order: r.order,
    kind: r.kind === "short" ? "short" : "video",
    status: (["idea", "in_progress", "published", "cancelled"].includes(r.status)
      ? r.status
      : "idea") as VideoView["status"],
    source: (["ai", "manual", "imported"].includes(r.source)
      ? r.source
      : "ai") as VideoView["source"],
    titles: r.titles ?? [],
    previewTexts: r.previewTexts ?? [],
    format: (r.format as VideoView["format"]) ?? null,
    noSpeaker: r.noSpeaker,
    huntStage: r.huntStage,
    pain: r.pain,
    questions: r.questions ?? [],
    nativeClose: r.nativeClose,
    cta: (r.cta as Cta | null) ?? null,
    visp: (r.visp as Visp | null) ?? null,
    reference: r.reference,
    whyWorks: r.whyWorks,
    opening: r.opening,
    youtubeVideoId: r.youtubeVideoId,
    thumbnail: r.thumbnail,
    views: r.views,
  };
}

export function toPlanView(
  plan: {
    id: string;
    period: string;
    label: string;
    niche: string | null;
    createdAt: Date;
    audience?: Prisma.JsonValue | null;
    huntLadder?: Prisma.JsonValue | null;
    funnel?: Prisma.JsonValue | null;
  },
  videos: VideoRow[]
): ContentPlanView {
  const views = videos.map(toVideoView);
  return {
    id: plan.id,
    period: plan.period,
    label: plan.label,
    niche: plan.niche,
    createdAt: plan.createdAt.toISOString(),
    videoCount: views.length,
    publishedCount: views.filter((v) => v.status === "published").length,
    videos: views,
    audience: (plan.audience as unknown as Persona[] | null) ?? null,
    huntLadder: (plan.huntLadder as unknown as HuntStep[] | null) ?? null,
    funnel: (plan.funnel as unknown as Funnel | null) ?? null,
  };
}
