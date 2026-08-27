"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Textarea,
  ActionIcon,
  Group,
  Box,
  Paper,
  Text,
  Button,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { IconSend, IconLock, IconPlayerStopFilled } from "@tabler/icons-react";
import type { ChatAccessReason } from "@/hooks/useChatAccess";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addMessage,
  setLoading,
  setSearching,
  setAnalyzingVideo,
  setStudyingPage,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
  prefillConsumed,
} from "@/store/chatSlice";
import type { ChatMessage } from "@/store/chatSlice";
import { bumpRequestsUsed } from "@/store/authSlice";
import { ymGoal } from "@/lib/metrika";
import QuickActions from "./QuickActions";
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

// ── Плавная «печать» ответа ──────────────────────────────────────────────────
// Модель отдаёт дельты рвано (то по букве, то целым предложением). Чтобы текст
// «печатался» ровно, копим пришедшее в буфер и раскрываем его в стор с постоянной
// частотой (~30fps) адаптивным шагом: малое отставание → по 2 символа за кадр,
// большое (стрим «убежал» вперёд) → ~1/8 остатка, чтобы догнать без рывка в конец.
// Уважает prefers-reduced-motion — там отдаём сразу, без анимации печати.
const TYPE_TICK_MS = 33; // ~30 кадров/с

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

interface Typewriter {
  push: (text: string) => void; // добавить пришедший из сети кусок
  end: () => Promise<void>; // дождаться, пока весь буфер допечатается
  cancel: () => void; // прервать (ошибка/размонтирование)
}

function makeTypewriter(onReveal: (chunk: string) => void): Typewriter {
  const instant = prefersReducedMotion();
  let received = "";
  let revealed = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ended = false;
  let resolveEnd: (() => void) | null = null;

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = () => {
    if (revealed < received.length) {
      const remaining = received.length - revealed;
      const step = Math.max(2, Math.ceil(remaining / 8));
      const chunk = received.slice(revealed, revealed + step);
      revealed += chunk.length;
      onReveal(chunk);
    }
    if (revealed >= received.length && ended) {
      stop();
      resolveEnd?.();
    }
  };

  return {
    push(text) {
      if (instant) {
        onReveal(text);
        return;
      }
      received += text;
      if (!timer) timer = setInterval(tick, TYPE_TICK_MS);
    },
    end() {
      if (instant || revealed >= received.length) return Promise.resolve();
      ended = true;
      return new Promise<void>((res) => (resolveEnd = res));
    },
    cancel() {
      stop();
      resolveEnd?.();
    },
  };
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

  // Подстановка запроса извне: плитки стартового экрана, быстрые действия, а также
  // переходы из ДРУГИХ разделов («Сгенерировать сценарий» в контент-плане, шаги
  // дорожной карты). ⚠️ Работает по модели «потребления», а НЕ по росту seq: при
  // переходе из другого раздела prefill ставится до монтирования этого компонента,
  // и сравнение счётчиков молча теряло текст. Забрали → гасим (prefillConsumed),
  // поэтому повторный клик по той же плитке тоже срабатывает.
  const prefill = useAppSelector((s) => s.chat.prefill);
  // Загружена ли история активного диалога — от неё зависит момент переподключения
  // к идущей генерации (см. эффект ниже).
  const messagesLoaded = useAppSelector(
    (s) => s.chat.conversations.find((c) => c.id === s.chat.activeId)?.messagesLoaded ?? false
  );
  useEffect(() => {
    if (!prefill.text) return;
    setInput(prefill.text);
    dispatch(prefillConsumed());
    const el = textareaRef.current;
    if (el) {
      el.focus();
      // Курсор в конец — плитки заканчиваются на «…тему: », юзер сразу дописывает.
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  }, [prefill, dispatch]);

  // ── Генерация как «прогон» на сервере ─────────────────────────────────────
  // ⚠️ Обрыв соединения БОЛЬШЕ НЕ останавливает генерацию (см. src/lib/chat-runs.ts):
  // раньше обновление страницы и нажатие «Остановить» выглядели для сервера
  // одинаково — как порванный fetch, — и ответ терялся в обоих случаях. Теперь
  // останов — отдельный запрос, а чтение потока можно прервать безнаказанно.
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Текст, показанный ДО переподключения (снимок прогона): хвост из стрима
  // приклеивается к нему.
  const streamPrefixRef = useRef("");

  const handleStop = useCallback(() => {
    const runId = runIdRef.current;
    if (!runId) {
      // Прогон ещё не представился (первое событие не пришло) — рвём чтение,
      // генерация сама завершится и ляжет в историю диалога.
      abortRef.current?.abort();
      return;
    }
    // Поток НЕ рвём: сервер сам закроет его событием stopped, и мы сохраним
    // напечатанное. Ошибку глотаем — кнопка не должна падать алертом.
    void fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    }).catch(() => {});
  }, []);

  // Размонтирование — прекращаем ЧИТАТЬ (генерация на сервере продолжается и
  // допишет ответ в историю; вернётся человек — подхватим через /api/chat/active).
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Чтение SSE-потока прогона в стор. Общая часть отправки и переподключения.
   * `from` > 0 — это переподключение: сервер отдаёт ХВОСТ с этой позиции, и его
   * надо приклеить к уже показанному (streamPrefixRef).
   */
  const consumeRun = useCallback(
    async (response: Response, opts: { from?: number } = {}) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Нет потока ответа");

      const typewriter = makeTypewriter((chunk) => dispatch(appendStreamingContent(chunk)));
      const decoder = new TextDecoder();
      let fullContent = "";
      let stoppedByUser = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") break;

            let parsed: {
              runId?: string;
              token?: string;
              error?: string;
              stopped?: boolean;
              searching?: boolean;
              analyzingVideo?: boolean;
              studyingPage?: boolean;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue; // битый JSON-чанк
            }
            // Первым событием прогон представляется: по этому id мы его
            // останавливаем и к нему же переподключаемся после перезагрузки.
            if (parsed.runId) runIdRef.current = parsed.runId;
            // Ошибку стрима пробрасываем НАРУЖУ (не глотаем), иначе в историю
            // попадёт пустой ответ вместо алерта об ошибке.
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.stopped) stoppedByUser = true;
            if (parsed.searching) dispatch(setSearching(true));
            if (parsed.analyzingVideo) dispatch(setAnalyzingVideo(true));
            // Человек прислал ссылку на сайт — читаем страницу, это секунды.
            if (parsed.studyingPage) dispatch(setStudyingPage(true));
            if (parsed.token) {
              fullContent += parsed.token;
              typewriter.push(parsed.token);
            }
          }
        }

        await typewriter.end();
        dispatch(finalizeStreaming());
        const shown = (opts.from ?? 0) > 0 ? streamPrefixRef.current + fullContent : fullContent;
        if (shown.trim()) {
          dispatch(
            addMessage({
              id: uuidv4(),
              role: "assistant",
              content: shown,
              createdAt: new Date().toISOString(),
            })
          );
        }
        // Квота списывается на сервере после успешного ответа — отражаем
        // оптимистично, чтобы кружок остатка в шапке не отставал. Остановленный
        // ответ не тарифицируется (сервер тоже не спишет).
        if (!stoppedByUser && shown.trim()) dispatch(bumpRequestsUsed());
      } catch (err) {
        typewriter.cancel(); // не оставляем таймер печати висеть
        throw err;
      }
    },
    [dispatch]
  );

  // ── Возврат к идущей генерации (после обновления страницы) ────────────────
  // ⚠️ Спрашиваем СЕРВЕР, а не localStorage: так ответ подхватывается и после F5,
  // и в другой вкладке. Прогон живой — показываем уже написанное и дочитываем.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || resumedFor.current === activeId) return;
    // ⚠️ Ждём, пока догрузится история диалога: она приходит отдельным запросом и
    // ЗАМЕНЯЕТ список сообщений целиком. Подключись мы раньше — дописанный ответ
    // мог бы попасть в стор до неё и быть затёрт (в БД он есть, но повторно
    // страница его не запросит — диалог уже помечен загруженным).
    if (!messagesLoaded) return;
    resumedFor.current = activeId;

    let alive = true;
    void (async () => {
      let attached = false;
      try {
        const res = await fetch(`/api/chat/active?conversationId=${encodeURIComponent(activeId)}`);
        if (!res.ok || !alive) return;
        const data = (await res.json()) as {
          run?: {
            id: string;
            text: string;
            searching: boolean;
            analyzingVideo: boolean;
            studyingPage: boolean;
          } | null;
        };
        const run = data.run;
        if (!run || !alive) return;

        attached = true;
        runIdRef.current = run.id;
        streamPrefixRef.current = run.text;
        dispatch(setLoading(true));
        // Уже написанное показываем СРАЗУ, без печати: человек его, скорее всего,
        // видел до перезагрузки, и «допечатывание» с нуля выглядит как сбой.
        dispatch(setStreamingContent(run.text));
        if (run.searching) dispatch(setSearching(true));
        if (run.analyzingVideo) dispatch(setAnalyzingVideo(true));
        if (run.studyingPage) dispatch(setStudyingPage(true));

        const controller = new AbortController();
        abortRef.current = controller;
        const stream = await fetch(
          `/api/chat/stream?runId=${encodeURIComponent(run.id)}&from=${run.text.length}`,
          { signal: controller.signal }
        );
        if (!stream.ok) {
          // Прогон исчез между двумя запросами — ответ уже в истории диалога.
          dispatch(finalizeStreaming());
          return;
        }
        await consumeRun(stream, { from: run.text.length });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        console.error("[chat] resume error:", err);
        dispatch(finalizeStreaming());
      } finally {
        if (attached) {
          abortRef.current = null;
          runIdRef.current = null;
          streamPrefixRef.current = "";
          dispatch(setLoading(false));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeId, messagesLoaded, dispatch, consumeRun]);

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

    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    streamPrefixRef.current = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, aboutYou, conversationId: convId }),
        signal: controller.signal,
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

      // Дальше всё общее с переподключением: чтение потока, печать, финализация.
      await consumeRun(response);
    } catch (err) {
      // ⚠️ Обрыв чтения (ушли со страницы, размонтировались) — НЕ ошибка и НЕ
      // потеря ответа: генерация живёт на сервере и допишется в историю, а
      // вернувшаяся вкладка подхватит её через /api/chat/active.
      if (controller.signal.aborted) {
        dispatch(finalizeStreaming());
      } else {
        const message = err instanceof Error ? err.message : "Произошла ошибка";
        dispatch(setError(message));
        dispatch(finalizeStreaming());
      }
    } finally {
      abortRef.current = null;
      runIdRef.current = null;
      streamPrefixRef.current = "";
      dispatch(setLoading(false));
    }
  }, [input, isLoading, locked, onUpgrade, messages, activeId, aboutYou, dispatch, consumeRun]);

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
      {/* Быстрые действия — те же готовые запросы, что на стартовом экране, но
          лентой над полем ввода: после первого сообщения стартовый экран
          пропадает, и функционал иначе становится недоступен. При исчерпанном
          доступе не показываем — там CTA на тариф, писать всё равно нельзя. */}
      {!locked && <QuickActions />}
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
        {/* Во время генерации кнопка превращается в «стоп»: останов уходит на
            сервер отдельным запросом (/api/chat/stop), напечатанное сохраняется,
            запрос из квоты НЕ тратится. */}
        {isLoading ? (
          <Tooltip label="Остановить генерацию" withArrow>
            <ActionIcon
              size="xl"
              radius="xl"
              variant="filled"
              color="gray"
              onClick={handleStop}
              aria-label="Остановить генерацию"
            >
              <IconPlayerStopFilled size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <ActionIcon
            size="xl"
            radius="xl"
            variant="filled"
            color="brand"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Отправить"
          >
            <IconSend size={20} />
          </ActionIcon>
        )}
      </Group>
      )}
    </Box>
  );
}
