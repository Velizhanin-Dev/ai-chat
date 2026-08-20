import { CHAT_DRAFT_KEY } from "./youtube-client";
import { insightPromptBlock } from "./competitors";
import type {
  CompetitorChannel,
  CompetitorFilters,
  CompetitorOrder,
  CompetitorResult,
  NicheChannelsResult,
  TrackedFeedResult,
  VideoInsight,
} from "./competitors";

// Клиентские обёртки над /api/competitors.

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

export interface CompetitorContextView {
  configured: boolean;
  channelConnected: boolean;
  channelTitle: string;
  suggested: string[];
  quota: {
    day: string;
    perKeyUnits: number;
    keys: { index: number; units: number; dead: null | "quota" | "invalid" }[];
    remaining: number;
  };
  searchCost: number;
  alerts: boolean;
  telegramLinked: boolean;
}

async function unwrap<T>(res: Response): Promise<Result<T>> {
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!res.ok || !data) {
    return {
      ok: false,
      error: data?.error ?? "Не удалось выполнить запрос",
      code: data?.code,
    };
  }
  return { ok: true, data };
}

export async function apiCompetitorContext(
  projectId: string
): Promise<Result<CompetitorContextView>> {
  try {
    const res = await fetch(`/api/competitors?projectId=${encodeURIComponent(projectId)}`);
    return unwrap<CompetitorContextView>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiCompetitorSearch(args: {
  projectId: string;
  queries: string[];
  periodDays: number;
  order: CompetitorOrder;
  /** Фильтры экрана — сервер листает выдачу, пока подходящих не наберётся 20. */
  filters: CompetitorFilters;
  /** "search" — новый поиск, "more" — добрать ещё к найденному. */
  mode?: "search" | "more";
}): Promise<Result<{ result: CompetitorResult; cached: boolean }>> {
  try {
    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return unwrap<{ result: CompetitorResult; cached: boolean }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Конкуренты-КАНАЛЫ: собираются поверх уже найденной выдачи роликов (агрегация
 * бесплатна, «рекомендованные каналы» — 1 unit на канал), своего поиска не
 * запускают. Нет свежей выдачи в памяти сервера → code CMP_EXPIRED.
 */
export async function apiNicheChannels(args: {
  projectId: string;
  queries: string[];
  periodDays: number;
  order: CompetitorOrder;
  filters: CompetitorFilters;
}): Promise<Result<{ result: NicheChannelsResult }>> {
  try {
    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...args, mode: "channels" }),
    });
    return unwrap<{ result: NicheChannelsResult }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/** Свой список конкурентов (каналы, добавленные руками). */
export async function apiTrackedChannels(
  projectId: string
): Promise<Result<{ channels: CompetitorChannel[] }>> {
  try {
    const res = await fetch(
      `/api/competitors?tracked=1&projectId=${encodeURIComponent(projectId)}`
    );
    return unwrap<{ channels: CompetitorChannel[] }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Добавить канал руками: ссылка, @хэндл или channel ID.
 * ⚠️ По ссылке/хэндлу/id это 1 unit, по НАЗВАНИЮ — 100 (search.list), см. resolveChannel.
 */
export async function apiAddTrackedChannel(args: {
  projectId: string;
  input: string;
}): Promise<Result<{ channel: CompetitorChannel }>> {
  try {
    const res = await fetch("/api/competitors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return unwrap<{ channel: CompetitorChannel }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiRemoveTrackedChannel(
  projectId: string,
  id: string
): Promise<Result<{ ok: true }>> {
  try {
    const res = await fetch(
      `/api/competitors?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    return unwrap<{ ok: true }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Лента новых роликов отслеживаемых каналов. Поиска не запускает: uploads-плейлист
 * канала стоит 2 units против 100 у search.list. `empty` — список конкурентов пуст.
 */
export async function apiTrackedFeed(args: {
  projectId: string;
  days: number;
  refresh?: boolean;
}): Promise<Result<{ result: TrackedFeedResult | null; empty: boolean }>> {
  try {
    const qs = new URLSearchParams({
      feed: "1",
      projectId: args.projectId,
      days: String(args.days),
    });
    if (args.refresh) qs.set("refresh", "1");
    const res = await fetch(`/api/competitors?${qs.toString()}`);
    return unwrap<{ result: TrackedFeedResult | null; empty: boolean }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Отправить упаковку конкурентов на разбор ассистенту: кладём готовый запрос
 * черновиком в чат (тот же механизм, что у «слабый CTR — переписать превью»).
 *
 * ⚠️ В промпт уходят РЕАЛЬНЫЕ названия конкурентов с их цифрами, а не просьба
 * «расскажи про упаковку»: без списка это была бы лекция про ВИСП, а с ним —
 * работа с конкретной нишей. Больше 12 роликов не берём: ответ всё равно режется
 * лимитом артефактов, а промпт раздувается.
 */
export function writeCompetitorsPrompt(
  userId: string,
  videos: { title: string; views: number; ratio: number; channelTitle: string }[],
  /** Подробности по нескольким верхним роликам: описание автора + комментарии. */
  insights: VideoInsight[] = []
): void {
  const list = videos
    .slice(0, 12)
    .map(
      (v, i) =>
        `${i + 1}. «${v.title}» — ${v.channelTitle}, ${v.views.toLocaleString("ru-RU")} просмотров (×${v.ratio.toFixed(1)} к подписчикам)`
    )
    .join("\n");

  // ⚠️ Подробности берём НЕ по всем: каждый ролик — 3 units квоты, а для вывода
  // «что общего у залетевших» хватает названий; описания и комментарии нужны, чтобы
  // разбор опирался на факты хотя бы по верхушке, а не только на заголовки.
  const details = insights.map((i) => insightPromptBlock(i)).join("\n\n");

  const text =
    `Вот ролики конкурентов из моей ниши, которые собрали просмотров кратно больше, ` +
    `чем у их каналов подписчиков:
${list}

` +
    `Разбери их упаковку: какие триггеры и заходы тут работают, что общего у залетевших, ` +
    `на какую боль и стадию осознанности они бьют. Потом дай мне 7 своих тем под МОЙ канал ` +
    `на этих же механиках — не копии, а тот же приём под мою нишу, с названием и текстом ` +
    `на превью. Заходы должны быть РАЗНЫЕ.` +
    (details ? `

---

Подробности по верхним роликам:

${details}` : "");
  try {
    localStorage.setItem(CHAT_DRAFT_KEY, JSON.stringify({ userId, text }));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

/** Включить/выключить уведомления «у конкурента залетел ролик» для проекта. */
export async function apiSetCompetitorAlerts(
  projectId: string,
  alerts: boolean
): Promise<Result<{ alerts: boolean }>> {
  try {
    const res = await fetch("/api/competitors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, alerts }),
    });
    return unwrap<{ alerts: boolean }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Данные чужого ролика для разбора референса (~3 units квоты YouTube, кэш 6 часов
 * на сервере). Принимает ссылку или id. Транскрипта в ответе нет и быть не может —
 * см. комментарий к VideoInsight.
 */
export async function apiVideoInsight(
  projectId: string,
  video: string
): Promise<Result<{ insight: VideoInsight }>> {
  try {
    const res = await fetch(
      `/api/video-insight?projectId=${encodeURIComponent(projectId)}&video=${encodeURIComponent(video)}`
    );
    return unwrap<{ insight: VideoInsight }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}
