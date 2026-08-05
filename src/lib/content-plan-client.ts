import type {
  BlockKey,
  ContentPlanMeta,
  ContentPlanView,
  LinkVideo,
  RegenPart,
  VideoView,
  VideoStatus,
} from "./content-plan";

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

export async function apiGeneratePlan(
  projectId: string,
  // Количество роликов фиксировано на сервере (PLAN_VIDEO_COUNT) — не передаём.
  opts: { period?: string; label?: string } = {}
): Promise<Result<{ plan: ContentPlanView }>> {
  try {
    return json(
      await fetch(`/api/content-plan?${q(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
    );
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
    return json(
      await fetch(`/api/content-plan/${planId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block }),
      })
    );
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
