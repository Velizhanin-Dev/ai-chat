"use client";

import { useEffect, useRef, useState } from "react";
import {
  Paper,
  Text,
  Stack,
  ScrollArea,
  Box,
  ThemeIcon,
  Loader,
  Center,
  ActionIcon,
} from "@mantine/core";
import { IconUser, IconRobot, IconArrowDown } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import type { ChatMessage } from "@/store/chatSlice";
import { splitConnectCta } from "@/lib/chat-markers";
import { apiYouTubeStatus } from "@/lib/youtube-client";
import Markdown from "./Markdown";
import ThinkingIndicator from "./ThinkingIndicator";
import ConnectYouTubeCta from "./ConnectYouTubeCta";
import ChatWelcome from "./ChatWelcome";

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

  // Показывать ли кнопку «вниз» (автоскролл отключён, а внизу что-то происходит).
  const [atBottom, setAtBottom] = useState(true);

  const distanceFromBottom = (el: HTMLDivElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight;

  // Позиция скролла меняется и программно, и руками — здесь только ВОЗВРАЩАЕМ
  // прилипание, когда пользователь сам довёл ленту до низа. Отключается оно не
  // тут, а по явному жесту вверх (см. wheel/touch/клавиши ниже): иначе наш же
  // программный скролл во время стрима гасил бы сам себя.
  const handleScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const near = distanceFromBottom(el) <= STICK_THRESHOLD;
    if (near) stickToBottom.current = true;
    setAtBottom(near);
  };

  // Жест «листаю вверх» → немедленно отпускаем ленту. Это и есть лечение
  // «дёрганья»: раньше во время стрима каждый новый токен утаскивал обратно вниз,
  // и прочитать написанное выше было невозможно.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const release = () => {
      stickToBottom.current = false;
      setAtBottom(distanceFromBottom(el) <= STICK_THRESHOLD);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) release();
    };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY + 4) release(); // палец вниз = контент едет вверх
      touchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") release();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const scrollToBottom = (smooth = false) => {
    const el = viewport.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setAtBottom(true);
  };

  // Открытие диалога (в т.ч. после F5) и переключение проекта — СРАЗУ внизу, без
  // анимации. `behavior:"smooth"` тут давал ту самую «прокрутку сверху вниз» на
  // глазах у пользователя. messagesLoaded в зависимостях: сообщения приезжают
  // лениво уже после смены activeId, и высота ленты меняется только тогда.
  const messagesLoaded = active?.messagesLoaded ?? false;
  useEffect(() => {
    if (!activeId) return;
    stickToBottom.current = true;
    // Двойной кадр: к первому ещё не сверстан markdown подгруженных сообщений.
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(() => scrollToBottom());
    });
    return () => cancelAnimationFrame(raf1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messagesLoaded]);

  // Отправил вопрос — возвращаемся вниз, даже если до этого листали историю
  // (явное действие пользователя, в отличие от прилетевшего токена стрима).
  const prevLoading = useRef(isLoading);
  useEffect(() => {
    if (isLoading && !prevLoading.current) scrollToBottom();
    prevLoading.current = isLoading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Во время стрима держим низ БЕЗ smooth: анимированная прокрутка не успевает
  // доехать до конца между токенами и выглядит как рывки.
  useEffect(() => {
    const el = viewport.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, streamingContent]);

  return (
    <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
    <ScrollArea
      style={{ height: "100%" }}
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
          <ChatWelcome projectId={activeId} ytConnected={ytConnected} />
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

      {/* Кнопка возврата вниз — появляется, когда автоскролл отпущен. Без неё
          после ручной прокрутки вверх во время стрима непонятно, как вернуться. */}
      {!atBottom && messages.length > 0 && (
        <ActionIcon
          onClick={() => scrollToBottom(true)}
          aria-label="Вниз"
          variant="filled"
          color="brand"
          radius="xl"
          size="lg"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            boxShadow: "var(--mantine-shadow-md)",
            zIndex: 5,
          }}
        >
          <IconArrowDown size={18} />
        </ActionIcon>
      )}
    </Box>
  );
}
