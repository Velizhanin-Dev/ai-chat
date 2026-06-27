"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Textarea, ActionIcon, Group, Box, Paper, Text, Button, ThemeIcon } from "@mantine/core";
import { IconSend, IconLock } from "@tabler/icons-react";
import type { ChatAccessReason } from "@/hooks/useChatAccess";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addMessage,
  setLoading,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
} from "@/store/chatSlice";
import type { ChatMessage } from "@/store/chatSlice";
import { bumpRequestsUsed } from "@/store/authSlice";
import { ymGoal } from "@/lib/metrika";
import { v4 as uuidv4 } from "uuid";

const EMPTY: ChatMessage[] = [];

// ── Черновик поля ввода в localStorage ──────────────────────────────────────
// Текст, который пользователь печатает но ещё не отправил, переживает обновление
// страницы. Пишем по debounce во время ввода, восстанавливаем при заходе на
// /chat, удаляем при отправке. Один ключ на пользователя (валидируем userId,
// как у черновика брифа) — на общем браузере чужой текст не подтянется.
const CHAT_DRAFT_KEY = "creative-chat:chat-draft-v1";

function loadChatDraft(userId: string): string | null {
  try {
    const raw = localStorage.getItem(CHAT_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { userId?: string; text?: string };
    if (!d || d.userId !== userId || typeof d.text !== "string") return null;
    return d.text.length ? d.text : null;
  } catch {
    return null;
  }
}

function saveChatDraft(userId: string, text: string) {
  try {
    localStorage.setItem(CHAT_DRAFT_KEY, JSON.stringify({ userId, text }));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

function clearChatDraft() {
  try {
    localStorage.removeItem(CHAT_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export default function ChatInput({
  locked = false,
  lockReason = "ok",
  onUpgrade,
}: {
  // Доступ исчерпан (тариф истёк / кончились запросы) — писать нельзя, показываем
  // CTA на оформление тарифа. Серверный гейт /api/chat дублирует это (источник правды).
  locked?: boolean;
  lockReason?: ChatAccessReason;
  onUpgrade?: () => void;
} = {}) {
  const [input, setInput] = useState("");
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const active = useAppSelector((s) =>
    s.chat.conversations.find((c) => c.id === s.chat.activeId)
  );
  const messages = active?.messages ?? EMPTY;
  const aboutYou = useAppSelector((s) => s.settings.aboutYou);
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  const inputFocusSignal = useAppSelector((s) => s.chat.inputFocusSignal);

  // ── Черновик ввода: debounce-сохранение + восстановление ──────────────────
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDraftTimer = () => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
  };
  // Откладываем запись на 400 мс после последнего нажатия. Вызывается только из
  // onChange (реальный ввод), поэтому программное восстановление не триггерит
  // запись и не затирает черновик.
  const scheduleDraftSave = (value: string) => {
    clearDraftTimer();
    if (!userId) return;
    const uid = userId;
    draftTimer.current = setTimeout(() => {
      if (value.trim()) saveChatDraft(uid, value);
      else clearChatDraft();
    }, 400);
  };

  // Восстановление — один раз, как только известен userId. Не затираем уже
  // начатый ввод (на случай, если юзер успел напечатать до гидратации).
  const draftRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current || !userId) return;
    draftRestored.current = true;
    const draft = loadChatDraft(userId);
    if (draft) setInput((prev) => (prev ? prev : draft));
  }, [userId]);

  // На размонтировании гасим отложенную запись (хвост ≤400 мс может потеряться —
  // это нормально для debounce; основной кейс «остановился и обновил» покрыт).
  useEffect(() => clearDraftTimer, []);

  // Фокус в поле ввода по сигналу из стора («Новый чат»). Первый прогон на
  // маунте пропускаем (prev === текущий), чтобы не перехватывать фокус при
  // обычном заходе на /chat — только по явному действию.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevFocusSignal = useRef(inputFocusSignal);
  useEffect(() => {
    if (prevFocusSignal.current !== inputFocusSignal) {
      prevFocusSignal.current = inputFocusSignal;
      textareaRef.current?.focus();
    }
  }, [inputFocusSignal]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;
    // Доступ исчерпан — не отправляем, зовём оформить тариф (на сервере тоже 403).
    if (locked) {
      onUpgrade?.();
      return;
    }

    // Чат идёт ВНУТРИ проекта — без активного проекта не отправляем (UI это и не
    // показывает: при отсутствии проекта рендерится бриф/пустой экран).
    if (!activeId) return;
    const convId = activeId;

    setInput("");
    // Черновик отправлен — гасим отложенную запись и чистим localStorage.
    clearDraftTimer();
    clearChatDraft();
    dispatch(setError(null));

    ymGoal("chat_message", { first: messages.length === 0 });

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
        body: JSON.stringify({ messages: history, aboutYou, conversationId: convId }),
      });

      if (!response.ok) {
        // Тело ошибки может быть НЕ JSON: в dev при пересборке сервера приходит
        // HTML-страница Next (отсюда «Unexpected token '<'»). Парсим безопасно.
        let msg = `Ошибка сервера (${response.status})`;
        let code: string | undefined;
        try {
          const err = await response.json();
          if (err?.error) msg = err.error;
          code = err?.code;
        } catch {
          if (response.status === 500 || response.status === 503) {
            msg = "Сервер перезапускается, попробуй отправить ещё раз";
          }
        }
        // Подписка кончилась / квота исчерпана прямо во время чата — не пугаем
        // красной ошибкой про биллинг, а открываем модалку «Подписка закончилась».
        if (code === "PLAN_EXPIRED" || code === "QUOTA_EXCEEDED") {
          dispatch(finalizeStreaming());
          onUpgrade?.();
          return; // setLoading(false) сделает finally
        }
        throw new Error(msg);
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
      // Списали 1 запрос на сервере (квота) — отражаем оптимистично на клиенте,
      // чтобы остаток в биллинге не отставал. Серверу это не доверяем (там — истина).
      dispatch(bumpRequestsUsed());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Произошла ошибка";
      dispatch(setError(message));
      dispatch(finalizeStreaming());
    } finally {
      dispatch(setLoading(false));
    }
  }, [input, isLoading, locked, onUpgrade, messages, activeId, aboutYou, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    // Композер — отдельный мягкий блок без обводки: скруглённая поверхность,
    // которая чуть приподнята над фоном (тема-токен, корректно в обеих темах).
    // Textarea — unstyled, сливается с поверхностью; фокус показываем кольцом
    // на самой поверхности (:focus-within), чтобы не терять видимость фокуса.
    <Box px={{ base: 4, sm: "md" }} pb="md" pt="xs" style={{ flexShrink: 0 }}>
      {locked ? (
        // Доступ исчерпан — вместо поля ввода CTA на оформление тарифа. История
        // чатов остаётся доступной (скролл выше), писать нельзя.
        <Paper withBorder radius="lg" p="md">
          <Group justify="space-between" gap="md" wrap="wrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <ThemeIcon color="brand" variant="light" radius="xl" size="lg">
                <IconLock size={18} />
              </ThemeIcon>
              <Text size="sm" c="dimmed" style={{ minWidth: 0 }}>
                {lockReason === "quota"
                  ? "Запросы на тарифе закончились — оформите тариф, чтобы продолжить."
                  : "Подписка закончилась — оформите тариф, чтобы продолжить."}
              </Text>
            </Group>
            <Button color="brand" radius="md" onClick={onUpgrade} style={{ flexShrink: 0 }}>
              Выбрать тариф
            </Button>
          </Group>
        </Paper>
      ) : (
      <Group
        align="flex-end"
        gap="xs"
        wrap="nowrap"
        className="chat-composer"
      >
        <Textarea
          ref={textareaRef}
          variant="unstyled"
          placeholder="Введите вопрос..."
          value={input}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setInput(v);
            scheduleDraftSave(v);
          }}
          onKeyDown={handleKeyDown}
          size="md"
          autosize
          minRows={2}
          maxRows={6}
          disabled={isLoading}
          style={{ flex: 1 }}
          styles={{ input: { paddingTop: 6, paddingBottom: 6, paddingLeft: 6 } }}
        />
        <ActionIcon
          size="xl"
          radius="xl"
          variant="filled"
          color="brand"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          loading={isLoading}
          aria-label="Отправить"
        >
          <IconSend size={20} />
        </ActionIcon>
      </Group>
      )}
    </Box>
  );
}
