"use client";

import { useEffect, useRef } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "./store";
import {
  hydrate,
  chatHydrated,
  type Conversation,
  type ChatMessage,
} from "./chatSlice";
import { hydrateSettings } from "./settingsSlice";
import type { AuthUser } from "./authSlice";

const CHAT_KEY = "creative-chat:conversations-v1";
const SETTINGS_KEY = "creative-chat:settings-v1";
// Старый ключ мок-авторизации — больше не пишем, но подчищаем при гидратации.
const LEGACY_AUTH_KEY = "creative-chat:auth-v1";
const LEGACY_CHAT_KEY = "creative-chat:chat-state-v1";

type PersistedChat = {
  conversations: Conversation[];
  activeId: string | null;
};

// Миграция старого формата (один диалог { messages, sessionId }) в новый список.
function loadLegacyChat(): PersistedChat | null {
  try {
    const raw = localStorage.getItem(LEGACY_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; sessionId?: string };
    if (!Array.isArray(parsed?.messages) || parsed.messages.length === 0) return null;
    const ts = parsed.messages[0]?.createdAt ?? new Date().toISOString();
    const first = parsed.messages.find((m) => m.role === "user")?.content ?? "";
    const conv: Conversation = {
      id: parsed.sessionId || "legacy",
      title: first ? first.slice(0, 40) : "Новый чат",
      messages: parsed.messages,
      createdAt: ts,
      updatedAt: parsed.messages[parsed.messages.length - 1]?.createdAt ?? ts,
    };
    return { conversations: [conv], activeId: conv.id };
  } catch {
    return null;
  }
}

export default function StoreProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  // Юзер из серверной cookie (SSR-засев). null = гость. Уже «ready», поэтому
  // UI не моргает «гость → юзер» и не дожидается сети.
  initialUser: AuthUser | null;
}) {
  // Стор на инстанс провайдера: на сервере — per-request (с засеянным auth),
  // на клиенте — один на всё приложение.
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore({ auth: { user: initialUser, ready: true } });
  }

  const hydratedRef = useRef(false);

  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    // Гидратация чата/настроек из localStorage — РОВНО один раз. Под React
    // StrictMode (dev) эффект монтируется дважды; гард не даёт перезагрузить
    // стор. Подписку на сохранение вешаем ВНЕ гарда, иначе после
    // StrictMode-cleanup она не переподпишется. Auth НЕ трогаем — он засеян
    // сервером и обновляется экшенами login/logout.
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      hydrateOnce(store);
    }

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      try {
        const { conversations, activeId } = state.chat;
        localStorage.setItem(
          CHAT_KEY,
          JSON.stringify({ conversations, activeId } satisfies PersistedChat)
        );
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        // auth НЕ персистим в localStorage — источник правды серверная cookie.
      } catch (err) {
        console.warn("[persist] save failed", err);
      }
    });

    return unsubscribe;
  }, []);

  return <Provider store={storeRef.current}>{children}</Provider>;
}

function hydrateOnce(store: AppStore) {
    // ── Чаты ────────────────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedChat;
        if (Array.isArray(parsed?.conversations)) {
          store.dispatch(
            hydrate({
              conversations: parsed.conversations,
              activeId: parsed.activeId ?? null,
            })
          );
        }
      } else {
        const legacy = loadLegacyChat();
        if (legacy) store.dispatch(hydrate(legacy));
      }
    } catch (err) {
      console.warn("[persist] chat hydrate failed", err);
    }
    // Помечаем гидратацию завершённой в любом случае (даже если localStorage пуст
    // или упал парсинг) — иначе сайдбар застрянет на скелетонах.
    store.dispatch(chatHydrated());
    // Диалог НЕ создаём заранее: пустое «новое» состояние, диалог появится при
    // первом сообщении (см. ChatInput).

    // ── Настройки ───────────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) store.dispatch(hydrateSettings(JSON.parse(raw)));
    } catch (err) {
      console.warn("[persist] settings hydrate failed", err);
    }

    // ── Auth ────────────────────────────────────────────────────────────
    // Чистим устаревший мок-ключ (вход теперь живёт в серверной cookie).
    try {
      localStorage.removeItem(LEGACY_AUTH_KEY);
    } catch {
      /* ignore */
    }
}
