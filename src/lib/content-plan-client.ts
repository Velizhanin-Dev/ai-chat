import type {
  BlockKey,
  ContentPlanMeta,
  ContentPlanView,
  LinkVideo,
  RegenPart,
  VideoView,
  VideoStatus,
} from "./content-plan";

import type { JobView } from "@/lib/jobs";
import {
  waitForJob,
  rememberJob,
  forgetJob,
  recallJob,
  apiActiveJobs,
} from "@/lib/jobs-client";

// Дождаться результата задачи по плану (генерация или опорный блок).
async function awaitPlanJob(jobId: string): Promise<ContentPlanView> {
  const job = await waitForJob(jobId);
  if (job.status !== "done") throw new Error(job.error || "Не удалось собрать план");
  return (job.result as { plan: ContentPlanView }).plan;
}

// Незаконченные задачи по плану в этом проекте — доска подхватывает их после
// перезагрузки: и саму генерацию, и авто-сборку опорных блоков следом за ней.
export async function findPendingPlanJobs(projectId: string): Promise<JobView[]> {
  const [gen, blocks] = await Promise.all([
    apiActiveJobs({ projectId, kind: "content_plan_generate" }),
    apiActiveJobs({ projectId, kind: "content_plan_block" }),
  ]);
  return [...gen, ...blocks];
}

export function recallPlanJob(projectId: string): string | null {
  return recallJob("content_plan_generate", projectId);
}

// ── Клиентские обёртки над /api/content-plan/* ──────────────────────────────

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

async function json<T>(res: Response): Promise<Result<T>> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: body.error || "Ошибка запроса", code: body.code };
  }
  return { ok: true, data: (await res.json()) as T };
}

export async function apiContentPlans(projectId: string): Promise<Result<{ plans: ContentPlanMeta[] }>> {
  try {
    return json(await fetch(`/api/content-plan?${q(projectId)}`, { cache: "no-store" }));
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Генерация плана ФОНОВАЯ: роут ставит задачу, воркер собирает план и следом
// сам ставит задачи на опорные блоки. Здесь дожидаемся готового плана, а id
// задачи держим в localStorage — обновил страницу, и доска подхватит её.
export async function apiGeneratePlan(
  projectId: string,
  // Количество роликов фиксировано на сервере (PLAN_VIDEO_COUNT) — не передаём.
  opts: { period?: string; label?: string } = {}
): Promise<Result<{ plan: ContentPlanView }>> {
  try {
    const started = await json<{ job: JobView }>(
      await fetch(`/api/content-plan?${q(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
    );
    if (!started.ok) return started;
    rememberJob("content_plan_generate", projectId, started.data.job.id);
    try {
      return { ok: true, data: { plan: await awaitPlanJob(started.data.job.id) } };
    } finally {
      forgetJob("content_plan_generate", projectId);
    }
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiContentPlan(planId: string): Promise<Result<{ plan: ContentPlanView }>> {
  try {
    return json(await fetch(`/api/content-plan/${planId}`, { cache: "no-store" }));
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiDeletePlan(planId: string): Promise<Result<{ ok: true }>> {
  try {
    return json(await fetch(`/api/content-plan/${planId}`, { method: "DELETE" }));
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Сгенерировать опорный блок плана (Фаза 3): портреты ЦА / Хант / воронка / шортсы.
export async function apiGenerateBlock(
  planId: string,
  block: BlockKey
): Promise<Result<{ plan: ContentPlanView }>> {
  try {
    const started = await json<{ job: JobView }>(
      await fetch(`/api/content-plan/${planId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block }),
      })
    );
    if (!started.ok) return started;
    return { ok: true, data: { plan: await awaitPlanJob(started.data.job.id) } };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Обновить просмотры у привязанных роликов (квоту не тратит).
// force=true — мимо кэша канала (кнопка), иначе из кэша (авто при открытии).
export async function apiResyncPlan(
  planId: string,
  force = false
): Promise<Result<{ connected: boolean; updated: number; plan?: ContentPlanView }>> {
  try {
    return json(
      await fetch(`/api/content-plan/${planId}/resync${force ? "?force=1" : ""}`, {
        method: "POST",
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Видео канала для привязки/импорта (Фаза 2).
export async function apiChannelVideosForLink(
  projectId: string
): Promise<Result<{ connected: boolean; videos: LinkVideo[] }>> {
  try {
    return json(await fetch(`/api/content-plan/channel-videos?${q(projectId)}`, { cache: "no-store" }));
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Привязать/отвязать реальный ролик канала (авто-статус «опубликовано» при привязке).
export async function apiLinkVideo(
  videoId: string,
  link: { youtubeVideoId: string; thumbnail: string | null; views: number } | null
): Promise<Result<{ video: VideoView }>> {
  const patch = link
    ? { youtubeVideoId: link.youtubeVideoId, thumbnail: link.thumbnail, views: link.views }
    : { youtubeVideoId: null };
  try {
    return json(
      await fetch(`/api/content-plan/video/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Переделать часть карточки ИИ (1 запрос).
export async function apiRegenerateVideo(
  videoId: string,
  part: RegenPart
): Promise<Result<{ video: VideoView }>> {
  try {
    return json(
      await fetch(`/api/content-plan/video/${videoId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part }),
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiAddVideo(
  planId: string,
  body: {
    kind?: "video" | "short";
    title?: string;
    youtubeVideoId?: string;
    thumbnail?: string | null;
    views?: number;
    /** Ролик-донор из «Референсов»: карточка заводится с source:"competitor". */
    reference?: string;
  } = {}
): Promise<Result<{ video: VideoView }>> {
  try {
    return json(
      await fetch(`/api/content-plan/${planId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiUpdateVideo(
  videoId: string,
  patch: Partial<Pick<VideoView, "titles" | "previewTexts" | "format" | "huntStage" | "pain" | "questions" | "nativeClose" | "reference" | "whyWorks" | "opening" | "noSpeaker" | "cta" | "visp" | "order">> & {
    status?: VideoStatus;
  }
): Promise<Result<{ video: VideoView }>> {
  try {
    return json(
      await fetch(`/api/content-plan/video/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiDeleteVideo(videoId: string): Promise<Result<{ ok: true }>> {
  try {
    return json(await fetch(`/api/content-plan/video/${videoId}`, { method: "DELETE" }));
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/**
 * Новый порядок карточек ОДНОЙ колонки (сверху вниз). Переезд из другой колонки
 * делается этим же запросом: и статус, и место в списке ставятся разом, без гонки
 * двух PATCH'ей. Возвращает все карточки плана — порядок мог сдвинуться.
 */
export async function apiReorderVideos(
  planId: string,
  status: VideoStatus,
  ids: string[]
): Promise<Result<{ videos: VideoView[] }>> {
  try {
    return json(
      await fetch(`/api/content-plan/${planId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ids }),
      })
    );
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}
