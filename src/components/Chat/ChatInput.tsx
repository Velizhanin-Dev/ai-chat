"use client";

import { useState, useCallback } from "react";
import { Textarea, ActionIcon, Group, Box } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addMessage,
  setLoading,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
} from "@/store/chatSlice";
import { v4 as uuidv4 } from "uuid";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const messages = useAppSelector((s) => s.chat.messages);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    dispatch(setError(null));
    const userMessage = {
      id: uuidv4(),
      role: "user" as const,
      content: question,
      createdAt: new Date().toISOString(),
    };
    dispatch(addMessage(userMessage));
    dispatch(setLoading(true));
    dispatch(setStreamingContent(""));

    const history = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
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

            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                fullContent += parsed.token;
                dispatch(appendStreamingContent(parsed.token));
              }
              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch {
              // skip malformed JSON chunks
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
    } finally {
      dispatch(setLoading(false));
    }
  }, [input, isLoading, messages, dispatch]);

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
          color="blue"
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
