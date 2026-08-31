// ── Ответы ассистента, которые переживают обновление страницы ────────────────
//
// ⚠️ Раньше генерация жила ВНУТРИ http-запроса: `POST /api/chat` стримил токены
// прямо из вызова модели и прерывал его по `request.signal`. Обновил страницу
// (или свернул вкладку так, что браузер порвал соединение) — ответ терялся
// НАВСЕГДА: генерация обрывалась, а частичный текст оставался только в Redux,
// который перезагрузку не переживает. На длинных сценариях это минуты работы и
// списанная квота в никуда.
//
// Теперь генерация — «прогон» (run), живущий В ПАМЯТИ ПРОЦЕССА и не привязанный
// к соединению. Запрос лишь ПОДПИСЫВАЕТСЯ на него: отвалился — прогон продолжает
// писать в свой буфер, а клиент после перезагрузки переподключается и дочитывает
// с той позиции, где остановился (`GET /api/chat/stream`), либо находит прогон по
// проекту (`GET /api/chat/active`). Останов теперь — ЯВНОЕ действие
// (`POST /api/chat/stop`), а не обрыв соединения.
//
// ⚠️ Реестр in-memory (как кэши дашборда и выдачи конкурентов): инстанс один.
// Для нескольких инстансов сюда нужен общий слой (Redis/БД) — меняется только
// этот модуль, роуты и клиент не трогаются.

import { prisma } from "./prisma";

export type ChatRunStatus = "running" | "done" | "error" | "stopped";

export interface ChatRunSnapshot {
  id: string;
  conversationId: string;
  status: ChatRunStatus;
  /** Уже сгенерированный текст целиком (для переподключения). */
  text: string;
  error: string | null;
  searching: boolean;
  analyzingVideo: boolean;
  /** Читаем страницу сайта, которую человек прислал ссылкой. */
  studyingPage: boolean;
  startedAt: number;
}

interface ChatRun {
  id: string;
  userId: string;
  conversationId: string;
  status: ChatRunStatus;
  text: string;
  error: string | null;
  searching: boolean;
  analyzingVideo: boolean;
  studyingPage: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Пользователь нажал «Остановить» — цикл генерации выйдет на ближайшем токене. */
  stopping: boolean;
  /** id записанного вопроса: пустой упавший прогон убирает его за собой. */
  questionMessageId: string | null;
  /** Разбудить подписчиков: любое изменение (токен, флаг, финал) резолвит их. */
  waiters: Array<() => void>;
}

const runs = new Map<string, ChatRun>();

// Сколько завершённый прогон ещё лежит в памяти: столько у вкладки есть на то,
// чтобы вернуться и дочитать хвост. Дальше ответ и так в истории диалога.
const DONE_TTL_MS = 10 * 60 * 1000;
// Страховка от «вечного» прогона (зависшая стратегия): после этого срока считаем
// его мёртвым и убираем из реестра, чтобы он не показывался клиенту как живой.
const RUNNING_TTL_MS = 20 * 60 * 1000;

// GC без таймеров: чистим на создании нового прогона. Висящий setInterval в
// serverless/при hot-reload пережил бы модуль и подтекал.
function sweep() {
  const now = Date.now();
  Array.from(runs.entries()).forEach(([id, r]) => {
    const age = now - (r.finishedAt ?? r.startedAt);
    if (r.status === "running" ? age > RUNNING_TTL_MS : age > DONE_TTL_MS) {
      runs.delete(id);
    }
  });
}

function notify(run: ChatRun) {
  const list = run.waiters;
  run.waiters = [];
  for (const w of list) w();
}

export function getRun(id: string, userId: string): ChatRun | null {
  const r = runs.get(id);
  if (!r || r.userId !== userId) return null;
  return r;
}

export function snapshot(r: ChatRun): ChatRunSnapshot {
  return {
    id: r.id,
    conversationId: r.conversationId,
    status: r.status,
    text: r.text,
    error: r.error,
    searching: r.searching,
    analyzingVideo: r.analyzingVideo,
    studyingPage: r.studyingPage,
    startedAt: r.startedAt,
  };
}

/**
 * Живой прогон проекта — то, к чему подключается вкладка после перезагрузки.
 *
 * ⚠️ Отдаём только `running`: завершённый ответ уже лежит в истории диалога и
 * приедет обычной загрузкой сообщений. Иначе он показался бы дважды.
 */
export function findActiveRun(
  conversationId: string,
  userId: string
): ChatRunSnapshot | null {
  let found: ChatRun | null = null;
  Array.from(runs.values()).forEach((r) => {
    if (r.userId !== userId || r.conversationId !== conversationId) return;
    if (r.status !== "running") return;
    if (!found || r.startedAt > found.startedAt) found = r;
  });
  return found ? snapshot(found as ChatRun) : null;
}

/** Пользователь нажал «Остановить». Идемпотентно. */
export function stopRun(id: string, userId: string): boolean {
  const r = getRun(id, userId);
  if (!r) return false;
  if (r.status === "running") {
    r.stopping = true;
    notify(r);
  }
  return true;
}

/**
 * Запустить прогон. Генерация уходит в фон (не привязана к вызвавшему запросу) —
 * вызывающий получает id и подписывается на него через `streamRun`.
 *
 * `generate` получает управление флагами индикаторов и приёмник токенов; всё, что
 * после генерации (запись ответа, квота, ачивки), делает `onFinish` — он вызывается
 * и при остановке, чтобы уже написанный кусок не пропал.
 */
export function startRun(opts: {
  userId: string;
  conversationId: string;
  /** Вопрос пользователя: сохраняем СРАЗУ, до генерации (см. persistQuestion). */
  question: string;
  /** Вложения вопроса (уже загружены на диск, тут только ссылки). */
  attachments?: { key: string; name: string; mime: string }[];
  generate: (ctx: {
    push: (token: string) => void;
    setSearching: () => void;
    setAnalyzingVideo: () => void;
    setStudyingPage: () => void;
    /** Нажали «Остановить» — цикл обязан выйти. */
    stopped: () => boolean;
  }) => Promise<void>;
  onFinish: (result: { text: string; stopped: boolean }) => Promise<void> | void;
}): ChatRunSnapshot {
  sweep();

  const run: ChatRun = {
    id: `run_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    userId: opts.userId,
    conversationId: opts.conversationId,
    status: "running",
    text: "",
    error: null,
    searching: false,
    analyzingVideo: false,
    studyingPage: false,
    startedAt: Date.now(),
    finishedAt: null,
    stopping: false,
    questionMessageId: null,
    waiters: [],
  };
  runs.set(run.id, run);

  // ⚠️ Вопрос пользователя пишем В ИСТОРИЮ СРАЗУ, а не парой с ответом, как
  // раньше. Иначе после перезагрузки лента открывается без заданного вопроса —
  // человек видит ответ, который «повис в воздухе», или пустой экран.
  const questionSaved = persistQuestion(
    opts.conversationId,
    opts.question,
    opts.attachments ?? []
  ).then((id) => {
    run.questionMessageId = id;
    return id;
  });

  void (async () => {
    try {
      await opts.generate({
        push: (token) => {
          run.text += token;
          notify(run);
        },
        setSearching: () => {
          run.searching = true;
          notify(run);
        },
        setAnalyzingVideo: () => {
          run.analyzingVideo = true;
          notify(run);
        },
        setStudyingPage: () => {
          run.studyingPage = true;
          notify(run);
        },
        stopped: () => run.stopping,
      });
      run.status = run.stopping ? "stopped" : "done";
    } catch (err) {
      console.error("[chat run] generation error:", err);
      run.status = "error";
      run.error = "Ошибка генерации ответа";
    } finally {
      run.finishedAt = Date.now();
      notify(run);
      // ⚠️ Генерация упала, не отдав НИ ОДНОГО символа — убираем записанный
      // вопрос. Иначе повторная отправка того же текста (обычная реакция на
      // ошибку) оставляет в истории два одинаковых вопроса подряд.
      if (run.status === "error" && !run.text.trim()) {
        const id = await questionSaved.catch(() => null);
        if (id) {
          await prisma.message
            .delete({ where: { id } })
            .catch((err) => console.error("[chat run] rollback question error:", err));
        }
      }
      try {
        await opts.onFinish({ text: run.text, stopped: run.status === "stopped" });
      } catch (err) {
        console.error("[chat run] finish error:", err);
      }
    }
  })();

  return snapshot(run);
}

async function persistQuestion(
  conversationId: string,
  content: string,
  attachments: { key: string; name: string; mime: string }[] = []
): Promise<string | null> {
  // Пустой текст допустим, когда есть вложения («вот, глянь» одним скриншотом).
  if (!content.trim() && attachments.length === 0) return null;
  try {
    // Создаём сообщение отдельно (а не вложенным create в диалог), чтобы знать
    // его id — по нему упавший прогон откатывает запись. Диалог всё равно
    // «поднимается» наверх: @updatedAt триггерится связью.
    const msg = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content,
        ...(attachments.length
          ? { attachments: attachments as unknown as object }
          : {}),
      },
      select: { id: true },
    });
    await prisma.conversation
      .update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    return msg.id;
  } catch (err) {
    console.error("[chat run] persist question error:", err);
    return null;
  }
}

// ── Подписка на прогон (SSE) ─────────────────────────────────────────────────

// Как часто шлём комментарий-пинг, если ничего не происходит: держим соединение
// живым через прокси и заодно замечаем отвалившегося клиента.
const PING_MS = 15_000;

function waitForChange(run: ChatRun): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(fire, PING_MS);
    run.waiters.push(fire);
  });
}

/**
 * SSE-поток по прогону, начиная с позиции `from` (сколько символов ответа у
 * клиента уже есть). Обрыв соединения генерацию НЕ трогает — прогон живёт сам.
 */
export function streamRun(run: ChatRun, from = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = Math.min(Math.max(from, 0), run.text.length);
  let sentSearching = false;
  let sentAnalyzing = false;
  let sentStudying = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // клиент отвалился между чанками
        }
      };
      const event = (o: unknown) => send(`data: ${JSON.stringify(o)}\n\n`);

      // Первым делом — кто мы: по этому id вкладка переподключается после F5.
      event({ runId: run.id });

      while (!closed) {
        if (run.searching && !sentSearching) {
          sentSearching = true;
          event({ searching: true });
        }
        if (run.analyzingVideo && !sentAnalyzing) {
          sentAnalyzing = true;
          event({ analyzingVideo: true });
        }
        if (run.studyingPage && !sentStudying) {
          sentStudying = true;
          event({ studyingPage: true });
        }
        if (run.text.length > sent) {
          event({ token: run.text.slice(sent) });
          sent = run.text.length;
        }
        if (run.status !== "running") {
          if (run.status === "error" && run.error) event({ error: run.error });
          if (run.status === "stopped") event({ stopped: true });
          send("data: [DONE]\n\n");
          break;
        }
        send(": ping\n\n");
        await waitForChange(run);
      }

      try {
        controller.close();
      } catch {
        /* уже закрыт обрывом клиента */
      }
    },
  });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
