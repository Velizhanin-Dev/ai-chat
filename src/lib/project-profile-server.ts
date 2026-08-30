// ── Генерация профиля проекта и разбора страниц ──────────────────────────────
//
// Разовые дорогие операции: результат ложится в БД и дальше подставляется во все
// генерации бесплатно. См. комментарий «зачем» в project-profile.ts.

import { prisma } from "./prisma";
import { enqueueJob } from "./jobs-server";
import { getStrategy } from "./llm";
import { buildSystem } from "./llm/system";
import { getSettings, structuredModelOf } from "./settings";
import { routeQuery, type RouteDecision } from "./router";
import { sanitizeBrief, withBriefTerms, briefSearchTerms, type Brief } from "./brief";
import { fetchPage, pagePromptBlock } from "./web-fetch";
import { getChannelSnapshotCached, getValidAccessToken, fetchChannelInfo, fetchRecentVideos } from "./youtube";
import { getPublicSnapshot, getPublicStats } from "./youtube-public";
import { getTranscript, condenseTranscript } from "./youtube-transcript";
import { buildChannelBlock } from "./llm/system";
import {
  sanitizeDigest,
  sanitizeProfile,
  type ProjectProfile,
  type SourceDigest,
} from "./project-profile";

/** Общий кусок: строгий JSON без markdown-обёртки. */
const JSON_ONLY = `# ФОРМАТ ЭТОЙ ЗАДАЧИ (строго)
Верни ТОЛЬКО валидный JSON без markdown-обёртки, без преамбул и без текста вокруг. Значения — по-русски.`;

function parseJson(raw: string): unknown {
  let t = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Служебный вызов модели: разбор фактов, а не генерация артефакта.
 *
 * ⚠️ База знаний тут подключается по минимуму (методика нужна для выводов о
 * контенте, но книгу и форматы тащить незачем), thinking выключен через
 * category:"chat" — как в автозаполнении брифа и разборе видео.
 */
async function runJsonTask(opts: {
  userId: string;
  projectId: string;
  brief: Brief | null;
  routeHint: string;
  system: string[];
  prompt: string;
}): Promise<unknown> {
  const settings = await getSettings();
  const provider = settings.provider;

  const route: RouteDecision = await routeQuery(
    [{ role: "user", content: opts.routeHint }],
    provider,
    { userId: opts.userId, conversationId: opts.projectId }
  );
  route.category = "chat";
  route.book = false;
  route.formats = false;
  route.contentPlan = false;
  route.tgClosed = true;
  route.youtube = true;

  const systemBlocks = buildSystem(
    route,
    withBriefTerms(route.searchQuery || opts.routeHint, opts.brief),
    "",
    opts.brief,
    ""
  );
  for (const extra of opts.system) {
    systemBlocks.push({ type: "text", text: extra });
  }
  systemBlocks.push({ type: "text", text: JSON_ONLY });

  const strategy = getStrategy(provider);
  let full = "";
  for await (const token of strategy.stream({
    system: systemBlocks,
    messages: [{ role: "user", content: opts.prompt }],
    route,
    routeMs: 0,
    model: structuredModelOf(settings).model,
    orParams: settings.openrouterParams,
    orProvider: structuredModelOf(settings).orProvider,
    meta: { userId: opts.userId, conversationId: opts.projectId },
  })) {
    full += token;
  }
  return parseJson(full);
}

// ── Разбор страницы ──────────────────────────────────────────────────────────

const DIGEST_PROMPT = `Разбери эту страницу как продюсер, которому по ней делать контент. Верни JSON:
{
  "summary": "что это одной фразой",
  "offer": "что предлагают и на каких условиях",
  "features": ["характеристики КАК НАПИСАНО на странице"],
  "benefits": ["те же характеристики, переведённые в человеческую выгоду: не «двор без машин», а «ребёнка можно отпустить гулять одного»"],
  "objections": ["возражения и страхи покупателя по этой теме — что мешает сказать «да»"],
  "pricing": ["цены и условия, если указаны"],
  "audience": ["кому подходит по версии самой страницы"]
}
⚠️ Бери ТОЛЬКО то, что есть на странице. Ничего не додумывай: нет цен — оставь пустой массив, а не выдумывай вилку. Возражения выводи из того, что страница пытается снять (гарантии, FAQ, «а если») — это тоже фактура, а не фантазия.`;

export type SourceOutcome =
  | { status: "ok"; title: string; digest: SourceDigest; text: string }
  | { status: "empty" } // страница открылась, но текста нет (SPA)
  | { status: "error"; message: string };

export async function analyzeSource(opts: {
  userId: string;
  projectId: string;
  url: string;
  brief: Brief | null;
}): Promise<SourceOutcome> {
  const res = await fetchPage(opts.url);
  if (res.status === "empty") return { status: "empty" };
  if (res.status === "error") return { status: "error", message: res.reason };

  const page = res.page;
  try {
    const raw = await runJsonTask({
      userId: opts.userId,
      projectId: opts.projectId,
      brief: opts.brief,
      routeHint: "разбор страницы клиента: оффер выгоды возражения цены целевая аудитория",
      system: [`# СТРАНИЦА ДЛЯ РАЗБОРА\n\n${pagePromptBlock(page)}`],
      prompt: DIGEST_PROMPT,
    });
    const digest = sanitizeDigest(raw);
    if (!digest) return { status: "error", message: "Не удалось разобрать страницу" };

    return {
      status: "ok",
      // Имя источника: заголовок страницы, если он вменяемый, иначе домен.
      title: page.title.slice(0, 120) || new URL(page.url).hostname,
      digest,
      text: page.text,
    };
  } catch (err) {
    console.error("[source] разбор страницы:", err);
    return { status: "error", message: "Не удалось разобрать страницу" };
  }
}

// ── Профиль проекта ──────────────────────────────────────────────────────────

const PROFILE_PROMPT = `Собери ПРОФИЛЬ ПРОЕКТА — рабочий документ, по которому дальше пишутся все сценарии, названия и планы. Верни JSON:
{
  "positioning": "кто это и чем отличается от соседа по нише — одной фразой, конкретно",
  "differentiators": ["3-5 отличий, которые видно со стороны, а не общие слова"],
  "segments": [{
    "name": "имя сегмента",
    "who": "кто это: роль, ситуация, в какой момент приходит",
    "pains": ["боли ОТ ПЕРВОГО ЛИЦА, словами самого человека"],
    "objections": ["почему НЕ купит и НЕ поверит"],
    "triggers": ["на что этот сегмент реагирует"]
  }],
  "vocabulary": ["слова и обороты, которыми говорят САМИ клиенты, а не отрасль"],
  "products": ["что продаёт и на чём зарабатывает"],
  "hookAngles": ["на чём строить заходы именно у этого проекта"],
  "formats": ["форматы и подача под тип харизмы спикера"],
  "tone": "тон и запреты: чего в кадре быть не должно",
  "unknowns": ["чего мы про проект НЕ знаем и что стоит спросить у клиента"],
  "speakerVoice": {
    "summary": "как он звучит: темп, регистр, манера — 2-3 фразы",
    "phrases": ["ДОСЛОВНЫЕ обороты из его речи, скопированные из расшифровки"],
    "address": "на ты или на вы, как называет зрителя",
    "humor": "чем шутит и шутит ли вообще",
    "avoid": ["обороты, которых у него не бывает"]
  }
}

⚠️ Это не эссе, а рабочая карта: каждый пункт должен быть применимым. «Хочет больше клиентов» — мусор, «боится, что после ремонта вылезут скрытые доплаты» — работает.
⚠️ Опирайся на то, что дано: бриф, данные канала, материалы клиента. Чего в данных нет — выноси в unknowns, а НЕ додумывай. Пустой unknowns — почти всегда признак, что ты что-то выдумал.
⚠️ segments — 3-4 штуки, не больше: это рабочие сегменты, а не перепись населения.
⚠️ speakerVoice заполняй ТОЛЬКО по расшифровкам его роликов, если они даны выше. Фразы — дословные цитаты из речи, скопированные буквой в букву, а не пересказ и не то, как «мог бы» говорить человек этой профессии. Расшифровок нет — верни speakerVoice: null. Выдуманный голос хуже, чем никакого: по нему будут писать сценарии, которые человек не сможет произнести.`;

// Сколько роликов разбираем ради голоса спикера.
//
// ⚠️ Три, а не десять: расшифровка идёт через внешний сервис и занимает десятки
// секунд на ролик (см. youtube-transcript.ts), а манера речи по трём роликам уже
// видна — она не меняется от видео к видео. Профиль собирается фоновой задачей,
// но и её нельзя растягивать на десять минут.
const VOICE_VIDEO_COUNT = 3;
/** Кусок расшифровки на ролик: манера видна и по первым минутам. */
const VOICE_EXCERPT = 2500;
/**
 * Общий бюджет времени на сбор расшифровок.
 *
 * ⚠️⚠️ Обязателен, и вот почему: добыча одной расшифровки может тянуться до трёх
 * минут (обход бот-проверки YouTube, перебор клиентов плеера — см.
 * youtube-transcript.ts), а очередь считает задачу зависшей через JOB_STALE_MS =
 * 5 минут и отдаёт её другому воркеру. Без потолка сборка профиля на канале без
 * субтитров уходила бы на второй круг и делала работу дважды. Успели собрать
 * меньше роликов — не беда: манера речи видна и по одному.
 */
const VOICE_BUDGET_MS = 90_000;

/**
 * Расшифровки последних роликов канала — сырьё для «голоса спикера».
 *
 * Best-effort целиком: нет канала, нет субтитров, сервис не ответил — возвращаем
 * пустую строку, и профиль собирается без голоса. Это не ошибка: у половины
 * каналов автосубтитров может не быть.
 */
async function resolveVoiceSource(projectId: string): Promise<{ text: string; count: number }> {
  try {
    // Список последних роликов: под OAuth — токеном канала, для канала по ссылке
    // — публичным списком. ⚠️ Сами расшифровки ПУБЛИЧНЫ (yt-dlp токена не требует
    // вообще), так что голос спикера собирается и у бренд-аккаунтов — а именно на
    // них жалоба «текст неживой» и била больнее всего.
    const integ = await prisma.youTubeIntegration.findUnique({
      where: { conversationId: projectId },
    });
    let videoRefs: { id: string; title: string }[];
    if (integ) {
      const token = await getValidAccessToken(integ);
      const info = await fetchChannelInfo(token);
      if (!info?.uploadsPlaylistId) return { text: "", count: 0 };
      const page = await fetchRecentVideos(token, info.uploadsPlaylistId, VOICE_VIDEO_COUNT);
      videoRefs = page.videos.map((v) => ({ id: v.id, title: v.title }));
    } else {
      const pub = await getPublicStats(projectId);
      if (!pub) return { text: "", count: 0 };
      videoRefs = pub.videos.slice(0, VOICE_VIDEO_COUNT).map((v) => ({ id: v.id, title: v.title }));
    }

    const parts: string[] = [];
    const deadline = Date.now() + VOICE_BUDGET_MS;
    for (const v of videoRefs.slice(0, VOICE_VIDEO_COUNT)) {
      if (Date.now() > deadline) break;
      const res = await getTranscript(v.id);
      if (res.status !== "ok") continue;
      parts.push(`### ${v.title}
${condenseTranscript(res.transcript, VOICE_EXCERPT)}`);
    }
    return { text: parts.join("\n\n"), count: parts.length };
  } catch (err) {
    console.error("[profile] расшифровки для голоса спикера:", err);
    return { text: "", count: 0 };
  }
}

export type ProfileOutcome =
  | { status: "ok"; profile: ProjectProfile }
  | { status: "error"; message: string };

/**
 * Собрать профиль проекта из всего, что о нём известно.
 *
 * ⚠️ Данные канала и материалы клиента — best-effort: канал может быть не
 * подключён, страниц может не быть вовсе. Профиль собирается и по одному брифу,
 * просто выйдет беднее — и это честно отразится в unknowns.
 */
export async function generateProfile(opts: {
  userId: string;
  projectId: string;
}): Promise<ProfileOutcome> {
  const conv = await prisma.conversation.findUnique({
    where: { id: opts.projectId },
    select: { brief: true },
  });
  const brief = conv?.brief ? sanitizeBrief(conv.brief) : null;

  const [channelBlock, sources, voice] = await Promise.all([
    resolveChannelBlock(opts.projectId),
    prisma.projectSource
      .findMany({
        where: { conversationId: opts.projectId },
        orderBy: { createdAt: "asc" },
        take: 10,
        select: { title: true, kind: true, url: true, digest: true },
      })
      .catch(() => []),
    // Расшифровки последних роликов — сырьё для «голоса спикера». Идут параллельно
    // со снимком канала: обе операции внешние и медленные.
    resolveVoiceSource(opts.projectId),
  ]);

  const system: string[] = [];
  if (channelBlock) system.push(channelBlock);
  if (voice.text) {
    system.push(
      [
        "# КАК ЭТОТ ЧЕЛОВЕК ГОВОРИТ В КАДРЕ — РАСШИФРОВКИ ЕГО РОЛИКОВ",
        `Ниже речь спикера с ${voice.count} его последних роликов, снятая с субтитров. Это его настоящая манера: обороты, темп, обращение к зрителю, слова-паразиты.`,
        "Из этого собери speakerVoice. Фразы бери ДОСЛОВНО — они пойдут в сценарии как опора, чтобы человек читал текст вслух и не спотыкался.",
        "",
        voice.text,
      ].join("\n")
    );
  }

  const withDigest = sources.filter((s) => s.digest);
  if (withDigest.length) {
    const { buildSourcesBlock } = await import("./project-profile");
    system.push(
      buildSourcesBlock(
        withDigest.map((s) => ({
          title: s.title,
          kind: s.kind,
          url: s.url,
          digest: s.digest as unknown as SourceDigest,
        }))
      )
    );
  }

  try {
    const raw = await runJsonTask({
      userId: opts.userId,
      projectId: opts.projectId,
      brief,
      routeHint: `${briefSearchTerms(brief)} позиционирование сегменты аудитории боли возражения лексика ниши заходы`,
      system,
      prompt: PROFILE_PROMPT,
    });
    const profile = sanitizeProfile(raw);
    if (!profile) return { status: "error", message: "Не удалось собрать профиль" };

    await prisma.conversation.update({
      where: { id: opts.projectId },
      data: { profile: profile as unknown as object, profileAt: new Date() },
    });
    return { status: "ok", profile };
  } catch (err) {
    console.error("[profile] сборка профиля:", err);
    return { status: "error", message: "Не удалось собрать профиль" };
  }
}


// ── Автосборка профиля в фоне ────────────────────────────────────────────────
//
// ⚠️ Профиль собирается САМ, а не по кнопке: человек только что прошёл бриф и
// хочет писать сценарии, а не жать «разобрать проект» — да и не знает, что это
// такое. Поэтому после создания проекта ставится фоновая задача, а первые ответы
// идут по брифу, как раньше (fallback в buildSystem). Готов профиль — со
// следующего сообщения он подставляется вместо анкеты.
//
// ⚠️⚠️ Квоту автосборка НЕ тратит, хотя ручная пересборка стоит PROFILE_QUOTA_COST.
// Причина та же, что у автозаполнения брифа: списывать два запроса из пробных
// двенадцати за то, чего человек не заказывал и не видел, — воровство. Стоимость
// всё равно видна в телеметрии (recordStat пишется стратегией).

/** Сколько ждать до следующей попытки, если сборка не удалась. */
const PROFILE_JOB_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Поставить фоновую сборку профиля, если она нужна.
 *
 * Best-effort и всегда fire-and-forget: сбой постановки не должен ронять ни
 * создание проекта, ни ответ в чате.
 *
 * @param hasProfile — если вызывающий уже прочитал профиль, передай, сэкономим запрос.
 * @param force — пересобрать, даже если профиль есть (поменялся бриф).
 */
export async function ensureProfileJob(opts: {
  userId: string;
  projectId: string;
  hasProfile?: boolean;
  force?: boolean;
}): Promise<void> {
  try {
    if (!opts.force) {
      let has = opts.hasProfile;
      if (has === undefined) {
        const row = await prisma.conversation.findUnique({
          where: { id: opts.projectId },
          select: { profile: true },
        });
        has = Boolean(row?.profile);
      }
      if (has) return;

      // ⚠️ Окно суток нужно ровно против одного сценария: сборка стабильно падает
      // (провайдер лёг, ключ протух), профиля так и нет — и без окна мы ставили бы
      // задачу на КАЖДОЕ сообщение в чате, потому что условие «профиля нет»
      // выполняется всегда. Считаем задачи в ЛЮБОМ статусе, включая error.
      const since = new Date(Date.now() - PROFILE_JOB_COOLDOWN_MS);
      const recent = await prisma.job.findFirst({
        where: {
          kind: "project_profile",
          conversationId: opts.projectId,
          createdAt: { gt: since },
        },
        select: { id: true },
      });
      if (recent) return;
    } else {
      // Принудительная пересборка (правка брифа) окном не ограничена — человек
      // именно за этим и правил анкету. Отсекаем только дубль на лету.
      const running = await prisma.job.findFirst({
        where: {
          kind: "project_profile",
          conversationId: opts.projectId,
          status: { in: ["queued", "running"] },
        },
        select: { id: true },
      });
      if (running) return;
    }

    await enqueueJob({
      kind: "project_profile",
      userId: opts.userId,
      conversationId: opts.projectId,
      payload: { auto: true },
    });
  } catch (err) {
    console.error("[profile] не удалось поставить фоновую сборку:", err);
  }
}

/** Снимок канала для промпта. Best-effort — как в content-plan-server. */
async function resolveChannelBlock(projectId: string): Promise<string | null> {
  try {
    const integ = await prisma.youTubeIntegration.findUnique({
      where: { conversationId: projectId },
    });
    if (!integ) {
      // Канал по ссылке — публичные цифры тоже фактура: профиль соберётся по
      // реальным роликам человека, а не по одной анкете.
      const pub = await getPublicSnapshot(projectId);
      return pub ? buildChannelBlock(pub, null, true) : null;
    }
    const snap = await getChannelSnapshotCached(projectId, integ);
    return snap ? buildChannelBlock(snap) : null;
  } catch {
    return null;
  }
}
