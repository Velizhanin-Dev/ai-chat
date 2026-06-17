"use client";

import { useEffect, useRef } from "react";
import { Provider } from "react-redux";
import { store } from "./store";
import {
  hydrate,
  type Conversation,
  type ChatMessage,
} from "./chatSlice";
import { hydrateSettings } from "./settingsSlice";
import { authHydrated } from "./authSlice";
import { fetchMe } from "@/lib/auth-client";

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
}: {
  children: React.ReactNode;
}) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Гидратация — РОВНО один раз. Под React StrictMode (dev) эффект монтируется
    // дважды; гард не даёт повторно загрузить стор. А вот подписку на сохранение
    // вешаем ВНЕ гарда (ниже), иначе после StrictMode-cleanup она не
    // переподпишется и в localStorage ничего не пишется.
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      hydrateOnce();
      // Auth живёт в httpOnly-cookie на сервере — тянем актуального юзера.
      fetchMe().then((user) => store.dispatch(authHydrated(user)));
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
        // auth НЕ персистим в localStorage — источник правды это серверная cookie.
      } catch (err) {
        console.warn("[persist] save failed", err);
      }
    });

    return unsubscribe;
  }, []);

  return <Provider store={store}>{children}</Provider>;
}

function hydrateOnce() {
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
