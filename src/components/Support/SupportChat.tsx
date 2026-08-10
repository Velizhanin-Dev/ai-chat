"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  ActionIcon,
} from "@mantine/core";
import { IconHeadset, IconSend, IconUser } from "@tabler/icons-react";
import type { SupportMessageRow, SupportRole } from "@/lib/support";
import { SUPPORT_MAX_LENGTH } from "@/lib/support";

// Лента чата техподдержки + композер. Визуал — тот же, что в разделе «Чат»:
// бабблы .bubble-user / .bubble-assistant, композер .chat-composer, аватары
// скрыты на мобиле (баббл во всю ширину). Отличие от чата с ассистентом —
// нет стрима и markdown: обе стороны пишут обычный текст.
//
// Компонент презентационный: сообщения и отправку даёт родитель (окно
// пользователя или экран админки). `me` — чьи сообщения рисуем справа: у
// пользователя это "user", у админа — "admin".

interface Props {
  messages: SupportMessageRow[];
  me: SupportRole;
  loading?: boolean;
  sending?: boolean;
  onSend: (text: string) => void;
  placeholder?: string;
  // Что показать на пустой переписке (у юзера — приглашение написать).
  emptyState?: React.ReactNode;
  disabled?: boolean;
}

export default function SupportChat({
  messages,
  me,
  loading = false,
  sending = false,
  onSend,
  placeholder = "Опишите вопрос...",
  emptyState,
  disabled = false,
}: Props) {
  const [input, setInput] = useState("");
  const viewport = useRef<HTMLDivElement>(null);

  // Держим низ ленты: при открытии и на каждое новое сообщение.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    if (!text || sending || disabled) return;
    onSend(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправка, Shift+Enter — перенос строки (как в основном чате).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea style={{ height: "100%" }} viewportRef={viewport}>
          <Stack gap="md" px={{ base: 4, sm: "md" }} py="md">
            {loading && messages.length === 0 && (
              <Center py={60}>
                <Loader color="brand" />
              </Center>
            )}

            {!loading && messages.length === 0 && emptyState}

            {messages.map((msg) => {
              const mine = msg.role === me;
              return (
                <Box
                  key={msg.id}
                  style={{
                    display: "flex",
                    // row-reverse инвертирует ось: чтобы прижать группу вправо,
                    // нужен flex-start (как в ChatWindow).
                    justifyContent: "flex-start",
                    gap: 8,
                    flexDirection: mine ? "row-reverse" : "row",
                    alignItems: "flex-start",
                  }}
                >
                  <ThemeIcon
                    size="lg"
                    radius="xl"
                    variant="light"
                    color={msg.role === "admin" ? "brand" : "gray"}
                    mt={4}
                    visibleFrom="sm"
                    style={{ flexShrink: 0 }}
                  >
                    {msg.role === "admin" ? (
                      <IconHeadset size={18} />
                    ) : (
                      <IconUser size={18} />
                    )}
                  </ThemeIcon>
                  <Paper
                    shadow="xs"
                    p="sm"
                    radius="md"
                    maw={{ base: "100%", sm: "78%" }}
                    className={mine ? "bubble-user" : "bubble-assistant"}
                    style={{ width: "fit-content" }}
                  >
                    <Text
                      size="sm"
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "inherit",
                      }}
                    >
                      {msg.content}
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      {new Date(msg.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Paper>
                </Box>
              );
            })}
          </Stack>
        </ScrollArea>
      </Box>

      <Group
        gap="xs"
        wrap="nowrap"
        align="flex-end"
        px={{ base: 4, sm: "md" }}
        className="chat-composer"
        mt="xs"
      >
        <Textarea
          variant="unstyled"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          size="md"
          autosize
          minRows={2}
          maxRows={6}
          maxLength={SUPPORT_MAX_LENGTH}
          disabled={disabled || sending}
          style={{ flex: 1 }}
          styles={{ input: { paddingTop: 6, paddingBottom: 6, paddingLeft: 6 } }}
        />
        <ActionIcon
          size="xl"
          radius="xl"
          variant="filled"
          color="brand"
          onClick={send}
          disabled={!input.trim() || sending || disabled}
          loading={sending}
          aria-label="Отправить"
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
