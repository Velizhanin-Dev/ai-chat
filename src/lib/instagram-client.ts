import type { IgSnapshot } from "./instagram-types";

// Клиентские обёртки над /api/integrations/instagram/*.

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

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

export interface IgStatus {
  configured: boolean;
  connected: boolean;
  account: {
    username: string;
    name: string;
    profilePicture: string | null;
    followers: number;
    expiresAt: string;
  } | null;
}

export async function apiInstagramStatus(projectId: string): Promise<Result<IgStatus>> {
  try {
    const res = await fetch(
      `/api/integrations/instagram?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" }
    );
    return unwrap<IgStatus>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiInstagramDisconnect(projectId: string): Promise<Result<{ ok: true }>> {
  try {
    const res = await fetch(
      `/api/integrations/instagram?projectId=${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    );
    return unwrap<{ ok: true }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

/** Полностраничный редирект на экран согласия Meta. */
export function instagramConnectHref(projectId: string, next: string): string {
  return (
    `/api/integrations/instagram/connect?projectId=${encodeURIComponent(projectId)}` +
    `&next=${encodeURIComponent(next)}`
  );
}

export async function apiInstagramData(args: {
  projectId: string;
  days: number;
  refresh?: boolean;
}): Promise<Result<{ snapshot: IgSnapshot }>> {
  try {
    const qs = new URLSearchParams({
      projectId: args.projectId,
      days: String(args.days),
    });
    if (args.refresh) qs.set("refresh", "1");
    const res = await fetch(`/api/integrations/instagram/data?${qs.toString()}`, {
      cache: "no-store",
    });
    return unwrap<{ snapshot: IgSnapshot }>(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Тексты для ?ig=<код> из колбэка — раздел показывает их тостом.
export const IG_CALLBACK_MESSAGE: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Instagram подключён" },
  cancelled: { ok: false, text: "Подключение отменено" },
  state: { ok: false, text: "Не удалось подтвердить запрос — попробуйте ещё раз" },
  auth: { ok: false, text: "Сессия истекла — войдите и повторите" },
  project: { ok: false, text: "Проект не найден" },
  // ⚠️ Без диагноза: в `failed` колбэк уходит по ЛЮБОМУ сбою после экрана согласия
  // (сеть до Meta, обмен кода, чтение профиля). Прежний текст «нужен профессиональный
  // аккаунт» выдавал догадку за причину — на проде так замаскировалась блокировка
  // доменов Meta из РФ. Причина — в логе сервера, строка `[instagram callback]`.
  failed: {
    ok: false,
    text: "Не удалось завершить подключение — попробуйте ещё раз. Если повторится, напишите в поддержку: причина уже в логе сервера.",
  },
};
