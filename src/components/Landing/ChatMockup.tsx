"use client";

import { Paper, Stack, Group, Text, Box } from "@mantine/core";
import LogoMark from "@/components/Brand/LogoMark";

export type MockMessage = { role: "user" | "assistant"; content: string };

const DEFAULT_MESSAGES: MockMessage[] = [
  {
    role: "user",
    content:
      "Дай хук для видео о том, как я ушёл из найма в свой блог",
  },
  {
    role: "assistant",
    content:
      "Смотри, «как я ушёл из офиса» в лоб — душнина, таких роликов миллион, их пролистывают. Заходим через цену решения: «Я посчитал, во сколько мне обошёлся бы ещё один год в найме. От этой цифры стало не по себе». Первые 5 секунд — конфликт и конкретная цифра, а уже потом разворачиваешь историю. Так удержим тех, кто сам подумывает уйти.",
  },
];

type ChatMockupProps = {
  messages?: MockMessage[];
  /** Показать индикатор «печатает» под последним сообщением. */
  typing?: boolean;
};

/**
 * Декоративный макет окна чата — главный «продуктовый» визуал лендинга
 * (по аналогии с тем, как Figma показывает свой холст в герое).
 * Не интерактивный: только демонстрирует тон и формат ответов.
 */
export default function ChatMockup({
  messages = DEFAULT_MESSAGES,
  typing = false,
}: ChatMockupProps) {
  return (
    <Paper
      radius="lg"
      withBorder
      shadow="xl"
      p={0}
      style={{
        overflow: "hidden",
        background: "var(--mantine-color-body)",
      }}
    >
      {/* Шапка окна */}
      <Group
        justify="space-between"
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap="xs">
          <LogoMark box="md" glyph={20} />
          <Text fw={600} size="sm">
            VELIZHANIN AI
          </Text>
        </Group>
        <Group gap={6}>
          <Box w={8} h={8} style={{ borderRadius: 999, background: "var(--mantine-color-gray-4)" }} />
          <Box w={8} h={8} style={{ borderRadius: 999, background: "var(--mantine-color-gray-4)" }} />
          <Box
            w={8}
            h={8}
            style={{ borderRadius: 999, background: "var(--color-accent)" }}
          />
        </Group>
      </Group>

      {/* Лента сообщений */}
      <Stack gap="sm" p="md">
        {messages.map((msg, i) => (
          <Box
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <Paper
              p="sm"
              radius="md"
              maw="86%"
              withBorder={msg.role === "assistant"}
              style={{
                background:
                  msg.role === "user"
                    ? "var(--mantine-color-brand-light)"
                    : "var(--mantine-color-body)",
              }}
            >
              <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {msg.content}
              </Text>
            </Paper>
          </Box>
        ))}

        {typing && (
          <Box style={{ display: "flex", justifyContent: "flex-start" }}>
            <Paper p="sm" radius="md" withBorder>
              <Text size="sm" c="dimmed" fs="italic">
                печатает
                <span style={{ animation: "blink 1s step-end infinite" }}>▊</span>
              </Text>
            </Paper>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
