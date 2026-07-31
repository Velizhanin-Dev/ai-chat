import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";
import { routeQuery } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import { buildSystem } from "@/lib/llm/system";
import { getValidAccessToken, assertOwnedProject } from "@/lib/youtube";
import { collectDiagnostics } from "@/lib/youtube-diagnostics";
import { paramsFor, kindLabel, periodLabelFull } from "@/lib/channel-params";
import { DIAGNOSE_PERIODS } from "@/lib/youtube-types";
import type {
  ChannelAnalysisResult,
  ChannelDiagnostics,
  DiagnoseKind,
  ParamVerdict,
} from "@/lib/youtube-types";

// Разбор канала по параметрам органического продвижения (кнопка «Разобрать канал»
// в разделе «Канал»). Сервер собирает цифры из Analytics API, модель выставляет по
// каждому параметру балл 0-100 и говорит, что чинить. ТРАТИТ 1 запрос квоты.
// Каждый разбор сохраняется в ChannelAnalysis — история видна в UI.

const KINDS: DiagnoseKind[] = ["all", "long", "shorts"];

// ── Промпт ────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")} %`;
}

// Текстовая выжимка снимка канала для модели.
function diagnosticsPrompt(d: ChannelDiagnostics): string {
  const specs = paramsFor(d.kind);
  const byKey = new Map(d.metrics.map((m) => [m.key, m]));

  const paramLines = specs
    .map((s, i) => {
      const m = byKey.get(s.key);
      const norm = s.norm ? `Норма по методике: ${s.norm}.` : "Жёсткой цифры-нормы в методике нет — оценивай по здравому смыслу методики и по нише.";
      const note = m?.note ? ` (${m.note})` : "";
      return `${i + 1}. key="${s.key}" — ${s.label}. Значение канала: ${
        m?.display ?? "нет данных"
      }${note}. ${norm} Как считали: ${s.measure}`;
    })
    .join("\n");

  const t = d.totals;
  const trend = d.prevTotals
    ? `Прошлый равный период: просмотров ${d.prevTotals.views}, удержание ${pct(
        d.prevTotals.avgViewPercentage
      )}, подписчиков +${d.prevTotals.subscribersGained}.`
    : "Данных за прошлый период нет.";

  const trafficRows = d.traffic ?? [];
  const trafficTotal = trafficRows.reduce((a, x) => a + x.views, 0);
  const traffic = trafficRows.length
    ? trafficRows
        .slice(0, 6)
        .map((s) => `${s.label} ${Math.round((s.views / Math.max(1, trafficTotal)) * 100)}%`)
        .join(", ")
    : "нет данных";

  const videos = d.videos.length
    ? d.videos
        .slice(0, 8)
        .map(
          (v) =>
            `— «${v.title}»: ${v.views} просмотров, удержание ${
              v.retention != null ? pct(v.retention) : "н/д"
            }, ср. просмотр ${v.avgDuration != null ? Math.round(v.avgDuration) + " с" : "н/д"}, длина ${
              v.durationSec
            } с, ${Object.entries(v.retentionAt)
              .map(([sec, val]) => `к ${sec}-й сек ${val != null ? pct(val) : "н/д"}`)
              .join(", ")}, лайков ${v.likes}, комментов ${v.comments}`
        )
        .join("\n")
    : "— роликов в срезе нет";

  const notes = d.notes.length ? d.notes.map((n) => `— ${n}`).join("\n") : "— всё измерилось";

  return `КАНАЛ: «${d.channel.title}» — ${d.channel.subscribers} подписчиков, ${d.channel.videoCount} роликов, ${d.channel.totalViews} просмотров за всё время.
СРЕЗ РАЗБОРА: ${kindLabel(d.kind)}, ${periodLabelFull(d.periodDays)} (${d.rangeStart} — ${d.rangeEnd}).

ИТОГИ ЗА ПЕРИОД: просмотров ${t.views}, время просмотра ${Math.round(t.minutes)} минут, подписалось ${
    t.subscribersGained
  }, отписалось ${t.subscribersLost}, лайков ${t.likes}, дизлайков ${t.dislikes}, комментов ${
    t.comments
  }, репостов ${t.shares}, среднее удержание ${pct(t.avgViewPercentage)}, среднее время просмотра ${Math.round(
    t.avgViewDuration
  )} с.
${trend}
ИСТОЧНИКИ ТРАФИКА: ${traffic}.

ПАРАМЕТРЫ (разбирай РОВНО их, все, по порядку):
${paramLines}

РОЛИКИ СРЕЗА (топ по просмотрам):
${videos}

ЧЕГО НЕ ХВАТИЛО В ДАННЫХ:
${notes}`;
}

function jsonSchemaBlock(keys: string[]): string {
  return `{"params":[${keys
    .map((k) => `{"key":"${k}","score":0-100,"verdict":"good|ok|bad","fact":"...","why":"...","todo":["..."]}`)
    .join(",")}],"overall":0-100,"summary":"...","priority":["...","..."]}`;
}

// ── Разбор ответа модели ──────────────────────────────────────────────────────

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function extractResult(text: string, keys: string[]): ChannelAnalysisResult | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const strArr = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
      : [];

  const raw = Array.isArray(o.params) ? (o.params as Record<string, unknown>[]) : [];
  const byKey = new Map(raw.filter((p) => typeof p?.key === "string").map((p) => [String(p.key), p]));
  // Держим порядок и полноту набора: параметр, который модель пропустила, всё равно
  // попадёт в круг — с нулевым баллом и честной пометкой.
  const params: ParamVerdict[] = keys.map((key) => {
    const p = byKey.get(key);
    const verdict = p?.verdict === "good" || p?.verdict === "bad" ? p.verdict : "ok";
    return {
      key: key as ParamVerdict["key"],
      score: p ? clampScore(p.score) : 0,
      verdict: p ? verdict : "ok",
      fact: typeof p?.fact === "string" ? p.fact.trim() : "Модель не дала оценку по этому параметру.",
      why: typeof p?.why === "string" ? p.why.trim() : "",
      todo: strArr(p?.todo, 3),
    };
  });
  if (!params.some((p) => p.fact && p.score > 0)) return null;

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const overall =
    o.overall != null
      ? clampScore(o.overall)
      : Math.round(params.reduce((a, p) => a + p.score, 0) / Math.max(1, params.length));
  return { params, overall, summary, priority: strArr(o.priority, 3) };
}

// ── GET: история разборов проекта ─────────────────────────────────────────────

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const { searchParams } = new URL(req.url);
  const owned = await assertOwnedProject(user.id, searchParams.get("projectId") ?? "");
  if (!owned) return apiError("Проект не найден", 404);

  const rows = await prisma.channelAnalysis.findMany({
    where: { conversationId: owned },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({
    analyses: rows.map((r) => ({
      id: r.id,
      kind: r.kind as DiagnoseKind,
      periodDays: r.periodDays,
      overallScore: r.overallScore,
      createdAt: r.createdAt.toISOString(),
      manualCtr: r.manualCtr,
      metrics: r.metrics,
      result: r.result,
    })),
  });
}

// ── POST: новый разбор ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const kind: DiagnoseKind = KINDS.includes(body?.kind as DiagnoseKind)
    ? (body!.kind as DiagnoseKind)
    : "all";
  const periodDays = (DIAGNOSE_PERIODS as readonly number[]).includes(Number(body?.periodDays))
    ? Number(body!.periodDays)
    : 28;
  // CTR из Studio: 0-100, всё остальное игнорируем.
  const rawCtr = Number(body?.manualCtr);
  const manualCtr = Number.isFinite(rawCtr) && rawCtr > 0 && rawCtr <= 100 ? rawCtr : null;

  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const conv = await prisma.conversation.findUnique({
    where: { id: owned },
    select: { brief: true },
  });
  const brief: Brief | null = isBriefComplete(sanitizeBrief(conv?.brief))
    ? sanitizeBrief(conv?.brief)
    : null;

  const integ = await prisma.youTubeIntegration.findUnique({ where: { conversationId: owned } });
  if (!integ) return apiError("YouTube не подключён", 404);

  // Квота: разбор канала тратит 1 запрос (как ответ в чате). Админам не лимитируем.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError(
        "Срок тарифа истёк. Подключите тариф в настройках → Биллинг.",
        403,
        "PLAN_EXPIRED"
      );
    }
    if (quota.reason === "quota") {
      return apiError(
        "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
        403,
        "QUOTA_EXCEEDED"
      );
    }
  }

  try {
    const accessToken = await getValidAccessToken(integ);
    const diagnostics = await collectDiagnostics(accessToken, { kind, periodDays, manualCtr });
    if (!diagnostics) {
      return apiError(
        "YouTube не отдал аналитику по каналу — попробуйте позже или другой период",
        502,
        "YT_ERROR"
      );
    }
    if (diagnostics.totals.views === 0) {
      return apiError(
        "За выбранный срез у канала нет просмотров — разбирать нечего. Возьмите период побольше.",
        400,
        "NO_DATA"
      );
    }

    const specs = paramsFor(kind);
    const keys = specs.map((s) => s.key);

    // Роутинг знаний под задачу: нужен слой аналитики/диагностики (закрытый TG +
    // разборы с YouTube), а книга/форматы/контент-планы — лишний объём токенов.
    const routeHint =
      "разбери мой youtube-канал по параметрам органического продвижения: удержание, первые секунды, среднее время просмотра, CTR превью, вовлечение, конверсия в подписку, поведение аудитории после просмотра, что чинить в первую очередь";
    const provider = settings.provider;
    const tRoute0 = Date.now();
    const route = await routeQuery([{ role: "user", content: routeHint }], provider, {
      userId: user.id,
      conversationId: owned,
    });
    const routeMs = Date.now() - tRoute0;
    // Как в ИИ-разборе видео: category→"chat" (у Claude отключается thinking, не
    // добавляется OUTPUT_DISCIPLINE — формат задаём своим блоком ниже), книга и
    // форматы off. Слои методики по аналитике оставляем включёнными.
    route.category = "chat";
    route.book = false;
    route.formats = false;
    route.contentPlan = false;
    route.tgClosed = true;
    route.youtube = true;

    const userName = user.name?.trim().slice(0, 100) ?? "";
    const systemBlocks = buildSystem(route, route.searchQuery || routeHint, "", brief, userName);
    systemBlocks.push({
      type: "text",
      text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (важно)
Это не чат, а диагностика канала по цифрам. Верни ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг.
Правила оценки:
- score 0-100 — насколько параметр в порядке ОТНОСИТЕЛЬНО нормы методики: 0-39 плохо (verdict "bad"), 40-69 средне ("ok"), 70-100 хорошо ("good"). Это заполнение сектора на круге — ставь честно, без завышения.
- Если по параметру «нет данных» — score 0, verdict "ok", в fact прямо напиши, что цифры нет и где её взять. НЕ выдумывай значение.
- fact — одна строка: цифра канала против нормы. why — что это значит на практике, без теории. todo — 1-3 конкретных действия под ЭТОТ канал и нишу, а не общие советы.
- Методику применяй молча: без терминов (ВИСП, лестница Ханта) и без названий типов харизмы, если человек сам ими не оперирует.
- Всё на русском, живым моим языком, без канцелярита. Никакого текста вне JSON.`,
    });

    const genPrompt = `Разбери мой YouTube-канал по параметрам органического продвижения.

${diagnosticsPrompt(diagnostics)}

Верни СТРОГО валидный JSON без markdown и без текста вокруг:
${jsonSchemaBlock(keys)}

Требования:
- В params — РОВНО ${keys.length} объектов с key из списка выше, в том же порядке.
- overall — общий балл канала 0-100 по этому срезу (не просто среднее: взвесь по важности параметров).
- summary — 3-5 предложений: главный вывод по каналу живым языком, с опорой на цифры.
- priority — 1-3 пункта: за что взяться в ближайших роликах, самое доходное первым.
Только JSON, ничего кроме него.`;

    const strategy = getStrategy(provider);
    let full = "";
    for await (const token of strategy.stream({
      system: systemBlocks,
      messages: [{ role: "user", content: genPrompt }],
      route,
      routeMs,
      model: settings.openrouterModel,
      orParams: settings.openrouterParams,
      orProvider: settings.openrouterProvider,
      meta: { userId: user.id, conversationId: owned },
    })) {
      full += token;
    }

    const result = extractResult(full, keys);
    if (!result) {
      console.error("[youtube diagnose] parse failed:", full.slice(0, 300));
      return apiError("Не удалось разобрать ответ модели, попробуйте ещё раз", 502, "YT_ERROR");
    }

    const row = await prisma.channelAnalysis.create({
      data: {
        conversationId: owned,
        userId: user.id,
        kind,
        periodDays,
        metrics: diagnostics as unknown as object,
        result: result as unknown as object,
        overallScore: result.overall,
        manualCtr,
        model: provider === "openrouter" ? settings.openrouterModel : provider,
      },
    });

    // Успех — списываем 1 запрос квоты (как в чате). Админам не списываем.
    if (!isAdmin(user)) {
      await prisma.user
        .update({ where: { id: user.id }, data: { requestsUsed: { increment: 1 } } })
        .catch((err) => console.error("[youtube diagnose] quota increment error:", err));
    }

    return NextResponse.json({
      analysis: {
        id: row.id,
        kind,
        periodDays,
        overallScore: result.overall,
        createdAt: row.createdAt.toISOString(),
        manualCtr,
        metrics: diagnostics,
        result,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message;
    if (
      status === 401 ||
      status === 403 ||
      msg === "no_refresh_token" ||
      msg === "token_refresh_failed"
    ) {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[youtube diagnose]", err);
    return apiError("Не удалось разобрать канал", 502, "YT_ERROR");
  }
}
