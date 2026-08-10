"use client";

import { isJobFinished, type JobKind, type JobView } from "@/lib/jobs";

// Клиентская часть очереди: запрос статуса + хук ожидания.

export async function apiGetJob(id: string): Promise<JobView> {
  const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Не удалось получить статус задачи");
  return data.job as JobView;
}

export async function apiActiveJobs(args: {
  projectId?: string;
  kind?: JobKind;
}): Promise<JobView[]> {
  const q = new URLSearchParams();
  if (args.projectId) q.set("projectId", args.projectId);
  if (args.kind) q.set("kind", args.kind);
  const res = await fetch(`/api/jobs?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.jobs ?? []) as JobView[];
}

// Ключ в localStorage: «какую задачу я жду на этой странице». Нужен, чтобы
// после обновления страницы сразу показать ожидание, не дожидаясь ответа
// /api/jobs. Сам список с сервера — источник правды, это лишь ускорение.
export function jobKey(kind: JobKind, projectId: string): string {
  return `creative-chat:job:${kind}:${projectId}`;
}

export function rememberJob(kind: JobKind, projectId: string, id: string): void {
  try {
    localStorage.setItem(jobKey(kind, projectId), id);
  } catch {
    /* приватный режим — переживём, сервер всё равно отдаст активные задачи */
  }
}

export function forgetJob(kind: JobKind, projectId: string): void {
  try {
    localStorage.removeItem(jobKey(kind, projectId));
  } catch {
    /* см. выше */
  }
}

export function recallJob(kind: JobKind, projectId: string): string | null {
  try {
    return localStorage.getItem(jobKey(kind, projectId));
  } catch {
    return null;
  }
}

// Опрос задачи до терминального состояния. Интервал 2с: задачи идут десятки
// секунд, чаще смысла нет.
export async function waitForJob(
  id: string,
  opts: { signal?: AbortSignal; intervalMs?: number } = {}
): Promise<JobView> {
  const interval = opts.intervalMs ?? 2000;
  for (;;) {
    if (opts.signal?.aborted) throw new Error("Ожидание прервано");
    const job = await apiGetJob(id);
    if (isJobFinished(job.status)) return job;
    await new Promise((r) => setTimeout(r, interval));
  }
}
