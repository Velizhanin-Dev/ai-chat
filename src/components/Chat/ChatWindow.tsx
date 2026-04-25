"use client";

import { useEffect, useRef } from "react";
import {
  Paper,
  Text,
  Stack,
  ScrollArea,
  Box,
  ThemeIcon,
} from "@mantine/core";
import { IconUser, IconRobot } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";

const STICK_THRESHOLD = 80;

export default function ChatWindow() {
  const messages = useAppSelector((s) => s.chat.messages);
  const streamingContent = useAppSelector((s) => s.chat.streamingContent);
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const viewport = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const handleScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom <= STICK_THRESHOLD;
  };

  useEffect(() => {
    if (!viewport.current || !stickToBottom.current) return;
    viewport.current.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streamingContent]);

  return (
    <ScrollArea
      h="calc(100vh - 260px)"
      viewportRef={viewport}
      onScrollPositionChange={handleScroll}
      offsetScrollbars
    >
      <Stack gap="md" p="md">
        {messages.length === 0 && !isLoading && (
          <Box ta="center" py={60}>
            <IconRobot size={48} stroke={1.2} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg" mt="md">
              Добро пожаловать в чат!
            </Text>
            <Text c="dimmed" size="sm" mt={4}>
              Спроси меня сгенерировать сценарий для видео или дать совет по YouTube-продвижению
            </Text>
          </Box>
        )}

        {messages.map((msg) => (
          <Box
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 8,
              flexDirection: msg.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-start",
            }}
          >
            <ThemeIcon
              size="lg"
              radius="xl"
              variant="light"
              color={msg.role === "user" ? "blue" : "teal"}
              mt={4}
            >
              {msg.role === "user" ? (
                <IconUser size={18} />
              ) : (
                <IconRobot size={18} />
              )}
            </ThemeIcon>
            <Paper
              shadow="xs"
              p="sm"
              radius="md"
              maw="75%"
              bg={msg.role === "user" ? "blue.0" : "gray.0"}
            >
              <Text
                size="sm"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {msg.content}
              </Text>
            </Paper>
          </Box>
        ))}

        {isLoading && (
          <Box
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <ThemeIcon
              size="lg"
              radius="xl"
              variant="light"
              color="teal"
              mt={4}
            >
              <IconRobot size={18} />
            </ThemeIcon>
            <Paper shadow="xs" p="sm" radius="md" maw="75%" bg="gray.0">
              <Text
                size="sm"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {streamingContent || (
                  <Text component="span" size="sm" c="dimmed" fs="italic">
                    печатает
                  </Text>
                )}
                <span style={{ animation: "blink 1s step-end infinite" }}>
                  ▊
                </span>
              </Text>
            </Paper>
          </Box>
        )}
      </Stack>
    </ScrollArea>
  );
}
