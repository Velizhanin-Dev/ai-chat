"use client";

import { useState, useCallback } from "react";
import { Textarea, ActionIcon, Group, Box } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addMessage,
  createConversation,
  renameConversation,
  setLoading,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
} from "@/store/chatSlice";
import type { ChatMessage } from "@/store/chatSlice";
import { v4 as uuidv4 } from "uuid";

const EMPTY: ChatMessage[] = [];

// Контекстный заголовок диалога от нейронки (как слева в ChatGPT/Claude).
// Тихо: при ошибке оставляем заголовок из первого сообщения (фолбэк уже в addMessage).
async function generateTitle(message: string, convId: string, dispatch: ReturnType<typeof useAppDispatch>) {
  try {
    const res = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { title?: string };
    if (data.title) dispatch(renameConversation({ id: convId, title: data.title }));
  } catch {
    // молча — фолбэк-заголовок уже стоит
  }
}

export default function ChatInput() {
  const [input, setInput] = useState("");
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const active = useAppSelector((s) =>
    s.chat.conversations.find((c) => c.id === s.chat.activeId)
  );
  const messages = active?.messages ?? EMPTY;
  const aboutYou = useAppSelector((s) => s.settings.aboutYou);
  const brief = useAppSelector((s) => s.auth.user?.brief ?? null);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    dispatch(setError(null));

    // Первое сообщение диалога? (нет активного ИЛИ активный пуст) — тогда после
    // отправки попросим у нейронки контекстный заголовок.
    const isFirstMessage = !activeId || messages.length === 0;
    // Диалог создаётся ЛЕНИВО — ровно здесь, при первом сообщении.
    let convId = activeId;
    if (!convId) {
      convId = dispatch(createConversation()).payload.id;
    }

    const userMessage = {
      id: uuidv4(),
      role: "user" as const,
      content: question,
      createdAt: new Date().toISOString(),
    };
    dispatch(addMessage(userMessage));
    dispatch(setLoading(true));
    dispatch(setStreamingContent(""));

    if (isFirstMessage && convId) {
      void generateTitle(question, convId, dispatch);
    }

    const history = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, aboutYou, brief }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Ошибка сервера");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Нет потока ответа");

      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;

            let parsed: { token?: string; error?: string };
            try {
              parsed = JSON.parse(data);
            } catch {
              // битый JSON-чанк — пропускаем
              continue;
            }
            // Ошибку стрима пробрасываем НАРУЖУ (не глотаем catch'ем парсинга),
            // иначе в историю попадёт пустой ответ вместо алерта об ошибке.
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.token) {
              fullContent += parsed.token;
              dispatch(appendStreamingContent(parsed.token));
            }
          }
        }
      }

      dispatch(finalizeStreaming());
      dispatch(
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: fullContent,
          createdAt: new Date().toISOString(),
        })
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Произошла ошибка";
      dispatch(setError(message));
      dispatch(finalizeStreaming());
    } finally {
      dispatch(setLoading(false));
    }
  }, [input, isLoading, messages, activeId, aboutYou, brief, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box p="md" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
      <Group align="flex-end" gap="sm">
        <Textarea
          placeholder="Введите вопрос..."
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={4}
          disabled={isLoading}
          style={{ flex: 1 }}
        />
        <ActionIcon
          size="xl"
          variant="filled"
          color="brand"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          loading={isLoading}
        >
          <IconSend size={20} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
