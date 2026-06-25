import type { ConversationMeta } from "@/app/api/conversations/route";
import type { ApiMessage } from "@/app/api/conversations/[id]/route";
import type { ChatMessage, Conversation } from "@/store/chatSlice";

// ── Клиентская обёртка над /api/conversations/* ───────────────────────────
// История чата живёт в БД (кросс-девайсно). Список — метаданными, сообщения —
// лениво по клику. Запись самих сообщений делает сервер внутри /api/chat.

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

// Метаданные с сервера → объект Conversation для стора (messages пустые, грузятся
// лениво при открытии). messagesLoaded=false помечает «сообщения ещё не тянули».
export function metaToConversation(m: ConversationMeta): Conversation {
  return {
    id: m.id,
    title: m.title,
    messages: [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    messagesLoaded: false,
  };
}

export async function apiListConversations(): Promise<Result<Conversation[]>> {
  try {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "Не удалось загрузить историю" };
    const data = (await res.json()) as { conversations: ConversationMeta[] };
    return { ok: true, data: data.conversations.map(metaToConversation) };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function apiGetMessages(id: string): Promise<Result<ChatMessage[]>> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
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
    const res = await fetch("/api/conversations/import", {
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
