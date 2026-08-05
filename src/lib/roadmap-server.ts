import type { YouTubeIntegration } from "@prisma/client";
import { prisma } from "./prisma";
import {
  assertOwnedProject,
  getValidAccessToken,
  fetchPeriodVideos,
  fetchVideoSubs,
} from "./youtube";
import { completeStep } from "./achievements-server";
import {
  buildRoadmapView,
  hasNewVideoSince,
  ROADMAP_ORDER,
  ROADMAP_THRESHOLDS,
  selectSteps,
  statusOf,
  stepApplies,
  type RoadmapSignals,
  type RoadmapStepKey,
  type RoadmapStepState,
  type RoadmapView,
} from "./roadmap";

// ── Движок дорожной карты: серверная часть ─────────────────────────────────
// docs/channel-roadmap.md. Собирает сигналы канала из YouTube, строит/освежает
// план шагов, проверяет выполнение диффом снапшотов и зажигает ачивки-шаги.

// Окно, за которое смотрим ролики для диагностики (широкое — чтобы SEO/CTR-доли
// считались по телу канала, а не по паре свежих роликов).
const WINDOW_DAYS = 365;
// Как часто пересобираем сигналы (дорогие вызовы YouTube). Между сборками отдаём
// сохранённый снимок. Кнопка «Проверить» форсит свежие (refresh).
const SIGNALS_TTL_MS = 30 * 60 * 1000;

export type RoadmapResult =
  | { status: "ok"; view: RoadmapView }
  | { status: "not_connected" }
  | { status: "not_found" };

// ISO8601 (PT12M34S) → секунды.
function isoToSeconds(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Собрать сигналы канала (ролики за окно + подписки по роликам → доли/конверсии).
// Best-effort: нет данных → соответствующее поле null (шаг по нему не оценивается).
async function collectSignals(integ: YouTubeIntegration): Promise<RoadmapSignals | null> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(integ);
  } catch {
    return null;
  }
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const videos = await fetchPeriodVideos(accessToken, ymd(start), ymd(end));
  if (videos.length === 0) return null;
  const subs = await fetchVideoSubs(accessToken, ymd(start), ymd(end));

  const t = ROADMAP_THRESHOLDS;
  const longs = videos.filter((v) => isoToSeconds(v.duration) > t.shortMaxSec);

  const under100 = videos.filter((v) => v.viewCount < t.seoViewsFloor).length;
  const longUnder1000 = longs.filter((v) => v.viewCount < t.ctrViewsFloor).length;

  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const totalEngage = videos.reduce((s, v) => s + v.likeCount + v.commentCount, 0);

  // Удержание лонгов — взвешенное по просмотрам среднее avgViewPercentage (0..100).
  const longViews = longs.reduce((s, v) => s + v.viewCount, 0);
  const longRetWeighted = longs.reduce(
    (s, v) => s + (v.avgViewPercentage ?? 0) * v.viewCount,
    0
  );

  // Конверсия в подписку — суммарно пришедшие подписчики / просмотры (по роликам,
  // у которых есть разрез подписок).
  let subGained = 0;
  let subViews = 0;
  for (const v of videos) {
    const s = subs[v.id];
    if (s) {
      subGained += s.gained;
      subViews += v.viewCount;
    }
  }

  const maxPublishedAt =
    videos.reduce<string | null>(
      (mx, v) => (v.publishedAt && (!mx || v.publishedAt > mx) ? v.publishedAt : mx),
      null
    ) ?? null;

  return {
    collectedAt: end.toISOString(),
    videoCount: videos.length,
    longCount: longs.length,
    seoShareUnder100: videos.length ? under100 / videos.length : null,
    ctrShareLongUnder1000: longs.length ? longUnder1000 / longs.length : null,
    engagement: totalViews > 0 ? totalEngage / totalViews : null,
    retentionLong: longViews > 0 ? longRetWeighted / longViews / 100 : null,
    subscribeConv: subViews > 0 ? subGained / subViews : null,
    maxPublishedAt,
  };
}

// Первичный план: актуальные шаги в порядке приоритета.
function planFrom(signals: RoadmapSignals): RoadmapStepState[] {
  return selectSteps(signals).map((key, i) => ({
    key,
    order: i,
    claimedAt: null,
    doneAt: null,
    baseline: null,
  }));
}

// Освежить план по свежим сигналам: проверить выполнение + добавить новые
// проблемы. Возвращает обновлённые состояния и список закрытых шагов (для ачивок).
function refreshStates(
  states: RoadmapStepState[],
  signals: RoadmapSignals,
  nowIso: string
): { states: RoadmapStepState[]; doneKeys: RoadmapStepKey[] } {
  const doneKeys: RoadmapStepKey[] = [];
  const next = states.map((st) => {
    if (st.doneAt) return st;
    const applies = stepApplies(st.key, signals);
    // Проблема ушла → шаг закрыт (реальное улучшение, даже без нажатия «Сделал»).
    if (!applies) {
      doneKeys.push(st.key);
      return { ...st, doneAt: nowIso };
    }
    // Заявлен «Сделал»: подтверждаем по появлению нового видео с момента claim
    // (метрики могли не успеть собраться). Иначе — галочка отжимается.
    if (st.claimedAt) {
      if (hasNewVideoSince(st.baseline, signals)) {
        doneKeys.push(st.key);
        return { ...st, doneAt: nowIso };
      }
      return { ...st, claimedAt: null, baseline: null };
    }
    return st;
  });

  // Добавить новые актуальные проблемы, которых ещё нет в плане (в конец).
  const have = new Set(next.map((s) => s.key));
  for (const key of ROADMAP_ORDER) {
    if (stepApplies(key, signals) && !have.has(key)) {
      next.push({ key, order: next.length, claimedAt: null, doneAt: null, baseline: null });
    }
  }
  return { states: next, doneKeys };
}

async function persist(
  conversationId: string,
  signals: RoadmapSignals,
  states: RoadmapStepState[]
): Promise<{ createdAt: Date; signalsAt: Date }> {
  const signalsAt = new Date(signals.collectedAt);
  const row = await prisma.channelRoadmap.upsert({
    where: { conversationId },
    create: {
      conversationId,
      signals: signals as unknown as object,
      signalsAt,
      steps: states as unknown as object,
    },
    update: {
      signals: signals as unknown as object,
      signalsAt,
      steps: states as unknown as object,
    },
    select: { createdAt: true, signalsAt: true },
  });
  return { createdAt: row.createdAt, signalsAt: row.signalsAt ?? signalsAt };
}

// Главная точка: витрина карты проекта. refresh=true форсит пересбор сигналов.
export async function getRoadmap(
  projectId: string,
  userId: string,
  opts: { refresh?: boolean } = {}
): Promise<RoadmapResult> {
  const owned = await assertOwnedProject(userId, projectId);
  if (!owned) return { status: "not_found" };

  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: owned },
  });
  if (!integ) return { status: "not_connected" };

  const row = await prisma.channelRoadmap.findUnique({ where: { conversationId: owned } });
  const now = new Date();
  let states = (row?.steps as unknown as RoadmapStepState[]) ?? [];
  let startedAt = row?.createdAt ?? now;
  let signalsAt = row?.signalsAt ?? null;

  const stale = !row?.signalsAt || now.getTime() - row.signalsAt.getTime() > SIGNALS_TTL_MS;
  if (opts.refresh || stale || !row) {
    const fresh = await collectSignals(integ);
    if (fresh) {
      if (!row || states.length === 0) {
        states = planFrom(fresh);
      } else {
        const res = refreshStates(states, fresh, now.toISOString());
        states = res.states;
        // Ачивки-шаги: зажигаем закрытые (fire-and-forget, не роняем ответ).
        for (const key of res.doneKeys) completeStep(userId, key).catch(() => {});
      }
      const saved = await persist(owned, fresh, states);
      startedAt = saved.createdAt;
      signalsAt = saved.signalsAt;
    }
  }

  return { status: "ok", view: buildRoadmapView(states, startedAt, signalsAt, now) };
}

// Пользователь нажал «Сделал» на открытом шаге: помечаем claimed + снимаем
// baseline (текущие сигналы), с которым сверимся при следующем разборе.
export async function claimRoadmapStep(
  projectId: string,
  userId: string,
  key: string
): Promise<RoadmapResult> {
  const owned = await assertOwnedProject(userId, projectId);
  if (!owned) return { status: "not_found" };

  const row = await prisma.channelRoadmap.findUnique({ where: { conversationId: owned } });
  if (!row) return getRoadmap(projectId, userId);
  const now = new Date();
  const states = (row.steps as unknown as RoadmapStepState[]) ?? [];
  const signals = (row.signals as unknown as RoadmapSignals | null) ?? null;

  const next = states.map((st) => {
    if (st.key !== key) return st;
    // Клеймить можно только открытый (разблокированный, не закрытый) шаг.
    if (statusOf(st, row.createdAt, now) !== "open") return st;
    return { ...st, claimedAt: now.toISOString(), baseline: signals };
  });

  await prisma.channelRoadmap.update({
    where: { conversationId: owned },
    data: { steps: next as unknown as object },
  });
  return {
    status: "ok",
    view: buildRoadmapView(next, row.createdAt, row.signalsAt ?? null, now),
  };
}

// Форс-верификация после нового разбора канала (fire-and-forget из diagnose).
// Пересобирает сигналы и проверяет шаги — тот же путь, что refresh.
export async function verifyRoadmapAfterDiagnose(
  projectId: string,
  userId: string
): Promise<void> {
  try {
    await getRoadmap(projectId, userId, { refresh: true });
  } catch (err) {
    console.error("[roadmap] verify after diagnose error:", err);
  }
}
