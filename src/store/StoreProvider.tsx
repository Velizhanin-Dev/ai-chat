"use client";

import { useEffect, useRef } from "react";
import { Provider } from "react-redux";
import { store } from "./store";
import { hydrate, ChatMessage } from "./chatSlice";

const STORAGE_KEY = "creative-chat:chat-state-v1";

type Persisted = {
  messages: ChatMessage[];
  sessionId: string;
};

export default function StoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed?.sessionId && Array.isArray(parsed.messages)) {
          store.dispatch(hydrate(parsed));
        }
      }
    } catch (err) {
      console.warn("[chat persist] hydrate failed", err);
    }

    const unsubscribe = store.subscribe(() => {
      const { messages, sessionId } = store.getState().chat;
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ messages, sessionId } satisfies Persisted)
        );
      } catch (err) {
        console.warn("[chat persist] save failed", err);
      }
    });

    return unsubscribe;
  }, []);

  return <Provider store={store}>{children}</Provider>;
}
