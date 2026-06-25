"use client";

import { useEffect, useRef } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "./store";
import { hydrateSettings } from "./settingsSlice";
import type { AuthUser } from "./authSlice";

const SETTINGS_KEY = "creative-chat:settings-v1";
// Старый ключ мок-авторизации — больше не пишем, но подчищаем при гидратации.
const LEGACY_AUTH_KEY = "creative-chat:auth-v1";
const LEGACY_CHAT_KEY = "creative-chat:chat-state-v1";
// Чаты раньше персистились сюда; теперь источник правды — БД (см. chat-client
// migrateLocalConversations + загрузчик истории в AppShell). Сам ключ
// «…:conversations-v1» НЕ чистим здесь — его читает миграция при первом заходе.

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

    // Гидратация настроек из localStorage — РОВНО один раз. Под React StrictMode
    // (dev) эффект монтируется дважды; гард не даёт перезагрузить стор. Подписку
    // на сохранение вешаем ВНЕ гарда, иначе после StrictMode-cleanup она не
    // переподпишется. Auth засеян сервером; история чата живёт в БД (грузится
    // загрузчиком в AppShell по факту входа) — здесь её не трогаем.
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      hydrateOnce(store);
    }

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      try {
        // Персистим только настройки. Auth — серверная cookie, чат — БД.
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      } catch (err) {
        console.warn("[persist] save failed", err);
      }
    });

    return unsubscribe;
  }, []);

  return <Provider store={storeRef.current}>{children}</Provider>;
}

function hydrateOnce(store: AppStore) {
  // ── Настройки ─────────────────────────────────────────────────────────
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) store.dispatch(hydrateSettings(JSON.parse(raw)));
  } catch (err) {
    console.warn("[persist] settings hydrate failed", err);
  }

  // ── Чистка устаревших ключей ──────────────────────────────────────────
  // Мок-авторизация и старый одно-диалоговый формат чата больше не нужны.
  try {
    localStorage.removeItem(LEGACY_AUTH_KEY);
    localStorage.removeItem(LEGACY_CHAT_KEY);
  } catch {
    /* ignore */
  }
}
