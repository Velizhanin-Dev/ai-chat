"use client";

import { useEffect, useRef, useState } from "react";
import { Paper, Text, Stack, ScrollArea, Box, ThemeIcon, Loader, Center } from "@mantine/core";
import { IconUser, IconRobot } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import type { ChatMessage } from "@/store/chatSlice";
import { splitConnectCta } from "@/lib/chat-markers";
import { apiYouTubeStatus } from "@/lib/youtube-client";
import Markdown from "./Markdown";
import ThinkingIndicator from "./ThinkingIndicator";
import ConnectYouTubeCta from "./ConnectYouTubeCta";

const STICK_THRESHOLD = 80;
const EMPTY: ChatMessage[] = [];

export default function ChatWindow() {
  const activeId = useAppSelector((s) => s.chat.activeId);
  // Селектим объект диалога (стабильная ссылка из стейта), messages выводим в
  // рендере — иначе `?? []` создаёт новый массив на каждый вызов селектора.
  const active = useAppSelector((s) =>
    s.chat.conversations.find((c) => c.id === s.chat.activeId)
  );
  const messages = active?.messages ?? EMPTY;
  const streamingContent = useAppSelector((s) => s.chat.streamingContent);
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const messagesLoading = useAppSelector((s) => s.chat.messagesLoading);
  const viewport = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Подключён ли YouTube у текущего проекта — гейтит CTA-кнопку под ответом (даже
  // если модель поставила маркер, при подключённом канале кнопку не показываем).
  // null — ещё не знаем (не мигаем кнопкой). activeId = id проекта/диалога.
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!activeId) {
      setYtConnected(null);
      return;
    }
    let alive = true;
    setYtConnected(null);
    apiYouTubeStatus(activeId).then((r) => {
      if (alive) setYtConnected(r.ok ? r.data.connected : null);
    });
    return () => {
      alive = false;
    };
  }, [activeId]);
  const showCta = ytConnected === false && !!activeId;

  const handleScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom <= STICK_THRESHOLD;
  };

  // При переключении диалога — прыжком в самый низ.
  useEffect(() => {
    stickToBottom.current = true;
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [activeId]);

  useEffect(() => {
    if (!viewport.current || !stickToBottom.current) return;
    viewport.current.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streamingContent]);

  return (
    <ScrollArea
      style={{ flex: 1, minHeight: 0 }}
      viewportRef={viewport}
      onScrollPositionChange={handleScroll}
    >
      <Stack gap="md" px={{ base: 4, sm: "md" }} py="md">
        {/* Ленивая загрузка сообщений открытого из истории диалога. */}
        {messagesLoading && messages.length === 0 && (
          <Center py={80}>
            <Loader color="brand" />
          </Center>
        )}

        {messages.length === 0 && !isLoading && !messagesLoading && (
          <Box ta="center" py={60}>
            <IconRobot size={48} stroke={1.2} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg" mt="md">
              Добро пожаловать в чат!
            </Text>
            <Text c="dimmed" size="sm" mt={4}>
              Спроси меня сгенерировать сценарий для видео или дать совет по
              YouTube-продвижению
            </Text>
          </Box>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          // Маркер подключения YouTube вырезаем из текста; кнопку показываем под
          // ответом, только если канал реально не подключён.
          const parsed = isUser ? null : splitConnectCta(msg.content);
          return (
            <Box
              key={msg.id}
              style={{
                display: "flex",
                // row-reverse инвертирует ось: чтобы прижать группу (баббл +
                // аватар) к правому краю, нужен flex-start, а не flex-end.
                justifyContent: "flex-start",
                gap: 8,
                flexDirection: isUser ? "row-reverse" : "row",
                alignItems: "flex-start",
              }}
            >
              {/* Аватар — только на десктопе (≥ sm). На мобиле прячем, чтобы баббл
                  занимал всю ширину и текст не жался. */}
              <ThemeIcon
                size="lg"
                radius="xl"
                variant="light"
                color={isUser ? "gray" : "brand"}
                mt={4}
                visibleFrom="sm"
                style={{ flexShrink: 0 }}
              >
                {isUser ? <IconUser size={18} /> : <IconRobot size={18} />}
              </ThemeIcon>
              <Paper
                shadow="xs"
                p="sm"
                radius="md"
                // Мобайл: во всю ширину (аватар скрыт) — текст не жмётся.
                // Десктоп — прежние 78%.
                maw={{ base: "100%", sm: "78%" }}
                className={isUser ? "bubble-user" : "bubble-assistant"}
                style={{ width: "fit-content" }}
              >
                {isUser ? (
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
                ) : (
                  <>
                    <Markdown content={parsed!.text} />
                    {parsed!.cta && showCta && activeId && (
                      <ConnectYouTubeCta projectId={activeId} />
                    )}
                  </>
                )}
              </Paper>
            </Box>
          );
        })}

        {isLoading && (
          <Box style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <ThemeIcon
              size="lg"
              radius="xl"
              variant="light"
              color="brand"
              mt={4}
              visibleFrom="sm"
              style={{ flexShrink: 0 }}
            >
              <IconRobot size={18} />
            </ThemeIcon>
            <Paper
              shadow="xs"
              p="sm"
              radius="md"
              maw={{ base: "100%", sm: "78%" }}
              className="bubble-assistant"
              style={{ width: "fit-content" }}
            >
              {streamingContent ? (
                <Markdown content={splitConnectCta(streamingContent).text} streaming />
              ) : (
                <ThinkingIndicator />
              )}
            </Paper>
          </Box>
        )}
      </Stack>
    </ScrollArea>
  );
}
