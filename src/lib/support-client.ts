import type { SupportMessageRow, SupportThreadRow } from "./support";

// Клиентские обёртки над /api/support/* и /api/admin/support/*. Ошибки бросаем
// текстом из тела — UI показывает его как есть.

async function fail(res: Response): Promise<never> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(data?.error || "Ошибка запроса");
}

// ── Сторона пользователя ───────────────────────────────────────────────────

// markRead=false — только забрать переписку, НЕ гася непрочитанные. Нужно, когда
// вкладка открыта, но скрыта: фоновый поллинг иначе «читает» ответ поддержки за
// человека, и бейдж непрочитанных не появляется.
export async function apiSupportMessages(
  markRead = true
): Promise<SupportMessageRow[]> {
  const res = await fetch(`/api/support${markRead ? "" : "?read=0"}`, {
    cache: "no-store",
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { messages: SupportMessageRow[] };
  return data.messages;
}

// ⚠️ Есть файлы — шлём multipart, нет — прежний JSON. Content-Type для multipart
// НЕ ставим руками: браузер сам допишет boundary, а заданный вручную заголовок
// его затрёт, и сервер не разберёт тело.
function supportBody(content: string, files: File[]): { body: BodyInit; headers?: HeadersInit } {
  if (files.length === 0) {
    return {
      body: JSON.stringify({ content }),
      headers: { "Content-Type": "application/json" },
    };
  }
  const form = new FormData();
  form.set("content", content);
  for (const f of files) form.append("files", f);
  return { body: form };
}

export async function apiSendSupportMessage(
  content: string,
  files: File[] = []
): Promise<SupportMessageRow> {
  const { body, headers } = supportBody(content, files);
  const res = await fetch("/api/support", { method: "POST", body, headers });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { message: SupportMessageRow };
  return data.message;
}

// Бейдж непрочитанных ответов поддержки. Тихо отдаём 0 на любой сбой (гость,
// сеть) — счётчик не должен ронять шапку.
export async function apiSupportUnread(): Promise<number> {
  try {
    const res = await fetch("/api/support/unread", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as { count: number };
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}

// ── Сторона админа ─────────────────────────────────────────────────────────

export interface SupportThreadsPage {
  threads: SupportThreadRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function apiAdminSupportThreads(params: {
  page?: number;
  q?: string;
  onlyUnread?: boolean;
}): Promise<SupportThreadsPage> {
  const qs = new URLSearchParams();
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  if (params.q) qs.set("q", params.q);
  if (params.onlyUnread) qs.set("filter", "unread");
  const res = await fetch(`/api/admin/support?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) await fail(res);
  return (await res.json()) as SupportThreadsPage;
}

export interface SupportThreadView {
  user: { id: string; name: string; email: string; plan: string };
  messages: SupportMessageRow[];
}

export async function apiAdminSupportThread(
  userId: string
): Promise<SupportThreadView> {
  const res = await fetch(`/api/admin/support/${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
  if (!res.ok) await fail(res);
  return (await res.json()) as SupportThreadView;
}

export async function apiAdminSupportReply(
  userId: string,
  content: string,
  files: File[] = []
): Promise<SupportMessageRow> {
  const { body, headers } = supportBody(content, files);
  const res = await fetch(`/api/admin/support/${encodeURIComponent(userId)}`, {
    method: "POST",
    body,
    headers,
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as { message: SupportMessageRow };
  return data.message;
}
