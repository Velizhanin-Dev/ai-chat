import type {
  RefRole,
  ThumbnailIdeas,
  ThumbnailRow,
  ThumbnailSpec,
} from "./thumbnails";

// Клиентские обёртки над /api/thumbnails/*. Ошибки бросаем текстом из тела —
// UI показывает его как есть (сервер уже формулирует по-человечески).

async function fail(res: Response): Promise<never> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(data?.error || "Ошибка запроса");
}

export async function apiListThumbnails(projectId: string): Promise<ThumbnailRow[]> {
  const res = await fetch(`/api/thumbnails?projectId=${encodeURIComponent(projectId)}`, {
    cache: "no-store",
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { items: ThumbnailRow[] };
  return data.items;
}

export async function apiUploadReference(
  projectId: string,
  file: File,
  role: RefRole,
  label = ""
): Promise<ThumbnailRow> {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("file", file);
  form.append("role", role);
  form.append("label", label);
  const res = await fetch("/api/thumbnails", { method: "POST", body: form });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { item: ThumbnailRow };
  return data.item;
}

export async function apiDeleteThumbnail(projectId: string, id: string): Promise<void> {
  const res = await fetch(
    `/api/thumbnails/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) await fail(res);
}

export async function apiGenerateThumbnail(
  projectId: string,
  spec: ThumbnailSpec,
  refIds: string[]
): Promise<ThumbnailRow> {
  const res = await fetch("/api/thumbnails/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, spec, refIds }),
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { item: ThumbnailRow };
  return data.item;
}

export async function apiThumbnailIdeas(
  projectId: string,
  spec: ThumbnailSpec
): Promise<ThumbnailIdeas> {
  const res = await fetch("/api/thumbnails/spec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, spec }),
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { ideas: ThumbnailIdeas };
  return data.ideas;
}
