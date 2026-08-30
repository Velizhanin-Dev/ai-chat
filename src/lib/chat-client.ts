import type { ConversationMeta } from "@/app/api/conversations/route";
import type { ApiMessage } from "@/app/api/conversations/[id]/route";
import { newProjectId, type ChatMessage, type Conversation } from "@/store/chatSlice";
import type { Brief } from "@/lib/brief";
import type { Platform } from "@/lib/platform";

// ── Клиентская обёртка над /api/conversations/* ───────────────────────────
// История чата живёт в БД (кросс-девайсно). Список — метаданными, сообщения —
// лениво по клику. Запись самих сообщений делает сервер внутри /api/chat.

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

// fetch с таймаутом: если сервер принял соединение, но не отвечает, обычный fetch
// висит вечно (в браузере — до ~5 мин). Из-за этого список диалогов мог залипать
// «вечным лоадером». AbortController обрывает запрос → вызов получает ошибку, а не
// зависание. 15с — с запасом для холодного старта, но не «навсегда».
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Метаданные с сервера → объект Conversation для стора (messages пустые, грузятся
// лениво при открытии). messagesLoaded=false помечает «сообщения ещё не тянули».
export function metaToConversation(m: ConversationMeta): Conversation {
  return {
    id: m.id,
    title: m.title,
    platform: m.platform ?? "youtube",
    messages: [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    messagesLoaded: false,
  };
}

export async function apiListConversations(): Promise<Result<Conversation[]>> {
  try {
    const res = await fetchWithTimeout("/api/conversations", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "Не удалось загрузить историю" };
    const data = (await res.json()) as { conversations: ConversationMeta[] };
    return { ok: true, data: data.conversations.map(metaToConversation) };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Создать проект (после прохождения брифа). Клиент генерит id (nanoid) и шлёт его
// + бриф; сервер вешает бриф на диалог, заголовок = название канала, проверяет
// лимит проектов тарифа. code="PROJECT_LIMIT" — слоты заняты (удалить проект).
export type CreateProjectResult =
  | { ok: true; data: Conversation }
  | { ok: false; error: string; code?: string };

// attachChannel — на первом шаге брифа юзер подключил YouTube-канал (черновик на
// юзере): просим сервер перевесить его на созданный проект. Без флага черновик не
// трогаем — иначе залипшее подключение от брошенного брифа молча прицепилось бы к
// следующему проекту, даже если там канал не подключали.
export async function apiCreateProject(
  brief: Brief,
  attachChannel = false,
  platform: Platform = "youtube",
  /** Канал, привязываемый ПО ССЫЛКЕ (channelId) — путь без OAuth. */
  linkChannel: string | null = null
): Promise<CreateProjectResult> {
  try {
    const id = newProjectId();
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, brief, attachChannel, platform, linkChannel }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      conversation?: ConversationMeta;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.conversation) {
      return { ok: false, error: data.error || "Не удалось создать проект", code: data.code };
    }
    const m = data.conversation;
    // Новый проект пуст → messagesLoaded=true (грузить нечего).
    return {
      ok: true,
      data: {
        id: m.id,
        title: m.title,
        platform: m.platform ?? "youtube",
        messages: [],
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        messagesLoaded: true,
      },
    };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiGetMessages(id: string): Promise<Result<ChatMessage[]>> {
  try {
    const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Не удалось загрузить диалог" };
    const data = (await res.json()) as { messages: ApiMessage[] };
    return { ok: true, data: data.messages };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Переименование и удаление — fire-and-forget (UI обновляем оптимистично, сервер
// синхронизируем в фоне). Возвращаем промис на случай, если вызвавший хочет ждать.
export function apiRenameConversation(id: string, title: string): Promise<unknown> {
  return fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).catch((err) => console.error("[chat] rename failed", err));
}

export function apiDeleteConversation(id: string): Promise<unknown> {
  return fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).catch((err) => console.error("[chat] delete failed", err));
}

// ── Бриф проекта (страница настроек проекта) ───────────────────────────────

// Прочитать бриф проекта (тип личности + поля «о проекте»).
export async function apiGetProjectBrief(id: string): Promise<Result<Brief>> {
  try {
    const res = await fetchWithTimeout(
      `/api/conversations/${encodeURIComponent(id)}/brief`,
      { cache: "no-store" }
    );
    if (!res.ok) return { ok: false, error: "Не удалось загрузить данные проекта" };
    const data = (await res.json()) as { brief: Brief };
    return { ok: true, data: data.brief };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// Перезаписать бриф проекта («Исправить информацию»). Тип личности обязателен.
export async function apiUpdateProjectBrief(
  id: string,
  brief: Brief
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/brief`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error || "Не удалось сохранить" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

// ── Разовая миграция истории из localStorage в БД ──────────────────────────
// Чаты раньше жили в localStorage (ключ ниже). При первом заходе залогиненного
// заливаем их в БД и удаляем ключ, чтобы не потерять. Идемпотентно (сервер
// пропускает уже существующие id). Best-effort: ошибка не блокирует загрузку.
const LEGACY_CHAT_KEY = "creative-chat:conversations-v1";

export async function migrateLocalConversations(): Promise<void> {
  let conversations: unknown;
  try {
    const raw = localStorage.getItem(LEGACY_CHAT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { conversations?: unknown };
    conversations = parsed?.conversations;
    if (!Array.isArray(conversations) || conversations.length === 0) {
      localStorage.removeItem(LEGACY_CHAT_KEY);
      return;
    }
  } catch {
    return;
  }

  try {
    const res = await fetchWithTimeout("/api/conversations/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversations }),
    });
    // Удаляем ключ только при успехе — иначе попробуем ещё раз в следующий заход.
    if (res.ok) localStorage.removeItem(LEGACY_CHAT_KEY);
  } catch (err) {
    console.error("[chat] migrate localStorage failed", err);
  }
}
