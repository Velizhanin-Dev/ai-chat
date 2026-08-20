import { NextRequest } from "next/server";
import { routeQuery, fullModeRoute } from "@/lib/router";
import { extractVideoIds } from "@/lib/chat-video";
import { buildVideoTranscriptBlock } from "@/lib/youtube-transcript";
import { getStrategy } from "@/lib/llm";
import { buildSystem, buildFullSystem, buildChannelBlock, type ConnectNudge } from "@/lib/llm/system";
import { getChannelSnapshotCached } from "@/lib/youtube";
import { CONNECT_YT_MARKER } from "@/lib/chat-markers";
import { sanitizeBrief, isBriefComplete, withBriefTerms, type Brief } from "@/lib/brief";
import { getSessionUser } from "@/lib/auth";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { prisma } from "@/lib/prisma";
import { track } from "@/lib/achievements-server";

// Сборка system-промпта (методика/голос/знания) вынесена в src/lib/llm/system.ts
// (buildSystem) — её переиспользует и ИИ-разбор видео. route.ts отвечает за
// роутинг знаний, гейты (auth/launch/бриф/квота) и SSE-обёртку стрима.

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

// Ограничение ожидания снимка канала перед ответом: если YouTube тупит — отвечаем
// без данных канала (следующее сообщение подхватит из кэша), а не ждём его.
const CHANNEL_SNAPSHOT_TIMEOUT_MS = 4_000;

// Сколько ждём расшифровку ролика перед ответом. ⚠️ Меньше таймаута самого сервиса
// (там потолок на весь путь): здесь человек уже отправил сообщение и смотрит на
// индикатор. Не успели — отвечаем без текста ролика, а расшифровка осядет в кэше
// и подхватится со следующего раза.
const TRANSCRIPT_WAIT_MS = 25_000;

// Promise с мягким таймаутом: по истечении отдаёт fallback (не бросает). Исходный
// промис не отменяем — он спокойно дорешается в фоне (снимок ляжет в кэш).
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    const settle = (v: T) => {
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve(v);
      }
    };
    p.then(settle, () => settle(fallback));
  });
}

// Контекст канала для промпта: снимок (если подключён, с таймаутом) ИЛИ режим
// приглашения подключить (active — пока не предлагали в этом диалоге, потом gentle).
// Best-effort: любая ошибка → без данных и без CTA, чат не роняем.
async function resolveChannelContext(
  conversationId: string,
  messages: ClientMessage[]
): Promise<{ channelBlock: string | null; nudge: ConnectNudge }> {
  try {
    const integ = await prisma.youTubeIntegration.findUnique({
      where: { conversationId },
    });
    if (!integ) {
      const alreadyNudged = messages.some(
        (m) => m.role === "assistant" && m.content.includes(CONNECT_YT_MARKER)
      );
      return { channelBlock: null, nudge: alreadyNudged ? "gentle" : "active" };
    }
    const [snap, lastCtr] = await Promise.all([
      withTimeout(getChannelSnapshotCached(conversationId, integ), CHANNEL_SNAPSHOT_TIMEOUT_MS, null),
      // CTR превью API не отдаёт; берём последнюю цифру, которую юзер сам ввёл в
      // разборе канала — чтобы в чате можно было говорить о кликабельности предметно.
      prisma.channelAnalysis
        .findFirst({
          where: { conversationId, manualCtr: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { manualCtr: true, createdAt: true },
        })
        .catch(() => null),
    ]);
    return {
      channelBlock: snap ? buildChannelBlock(snap, lastCtr?.manualCtr ?? null) : null,
      nudge: "off",
    };
  } catch (err) {
    console.error("[chat] channel context error:", err);
    return { channelBlock: null, nudge: "off" };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawMessages: unknown = body?.messages;
    const aboutYou =
      typeof body?.aboutYou === "string" ? body.aboutYou.trim().slice(0, 2000) : "";

    // Имя — из серверной сессии (источник правды), а не с клиента.
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return new Response(JSON.stringify({ error: "Войдите, чтобы общаться" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Глобальные настройки (провайдер модели + режим запуска) — читаем один раз.
    const settings = await getSettings();

    // Режим «до запуска»: пока таймер активен, ассистентом пользуются только
    // админы. Это надёжный серверный гейт (клиентские кнопки/страницы — лишь UX).
    if (isLaunchLocked(settings) && !isAdmin(sessionUser)) {
      return new Response(
        JSON.stringify({
          error: "AI-ассистент ещё не запущен — открой чат после старта",
          code: "LAUNCH_LOCKED",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages обязателен и не должен быть пустым" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const messages: ClientMessage[] = rawMessages
      .filter(
        (m): m is ClientMessage =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }));

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return new Response(
        JSON.stringify({ error: "Последнее сообщение должно быть от пользователя" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const lastUserContent = messages[messages.length - 1].content;

    // ── Проект (1 проект = 1 диалог) ───────────────────────────────────────
    // Чат идёт ВНУТРИ существующего проекта: клиент шлёт его id. Бриф крепится к
    // проекту (Conversation.brief) — это источник правды для промпта и гейта
    // (раньше бриф был на User). Чужой/несуществующий проект — 404; без брифа —
    // 403 (создаётся он только через POST /api/conversations с пройденным брифом).
    const conversationId =
      typeof body?.conversationId === "string" && body.conversationId.length <= 64
        ? body.conversationId
        : null;
    if (!conversationId) {
      return new Response(
        JSON.stringify({ error: "Проект не выбран", code: "NO_PROJECT" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, brief: true },
    });
    if (!conv || conv.userId !== sessionUser.id) {
      return new Response(JSON.stringify({ error: "Проект не найден" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const brief: Brief | null = isBriefComplete(sanitizeBrief(conv.brief))
      ? sanitizeBrief(conv.brief)
      : null;
    if (!brief) {
      return new Response(
        JSON.stringify({ error: "Сначала пройдите бриф проекта", code: "BRIEF_REQUIRED" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    const persistId = conversationId;

    // Квоты тарифа: срок (пробный — 1 час, платный — 30 дней) + лимит запросов
    // (Plan.limits.requests, -1 = без лимита; правится в админке). Один ответ
    // ассистента = 1 единица. Источник правды — сервер. Админам не лимитируем.
    if (!isAdmin(sessionUser)) {
      const quota = await getQuotaState(sessionUser);
      if (quota.reason === "expired") {
        return new Response(
          JSON.stringify({
            error:
              "Срок тарифа истёк. Подключите тариф «Базовый» или «Максимальный» в настройках → Биллинг.",
            code: "PLAN_EXPIRED",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
      if (quota.reason === "quota") {
        return new Response(
          JSON.stringify({
            error:
              "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
            code: "QUOTA_EXCEEDED",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const userName = sessionUser.name?.trim().slice(0, 100) ?? "";

    // Провайдер модели — ГЛОБАЛЬНЫЙ, из настроек админки (не из тела запроса).
    // Пользователь движок не выбирает.
    const provider = settings.provider;

    // Контекст канала (снимок + режим CTA) и роутинг знаний — ПАРАЛЛЕЛЬНО: они
    // независимы, и складывать их задержки перед первым токеном не нужно. У снимка
    // канала — таймаут (resolveChannelContext), чтобы медленный YouTube не держал
    // ответ; у роутера — свой таймаут (router.ts → откат на эвристику).
    //  • routing "full" — вся база целиком, без LLM-роутера (эвристика категории);
    //  • routing "smart" — BM25-роутинг: классифицируем и грузим только релевантное.
    const lastUser = messages[messages.length - 1].content;
    const tRoute0 = Date.now();
    const [channel, route] = await Promise.all([
      resolveChannelContext(conversationId, messages),
      settings.routing === "full"
        ? Promise.resolve(fullModeRoute(lastUser))
        : routeQuery(messages, provider, { userId: sessionUser.id, conversationId }),
    ]);
    const routeMs = Date.now() - tRoute0;

    const systemBlocks =
      settings.routing === "full"
        ? buildFullSystem(route.category, aboutYou, brief, userName, channel.channelBlock, channel.nudge)
        : buildSystem(
            route,
            // Слова ниши клиента подмешиваем в запрос к базе: без них BM25 ранжирует
            // по терминам методики от роутера и тащит теорию вместо нишевой фактуры
            // (см. withBriefTerms в brief.ts). Токенов не стоит — меняется ранжирование.
            withBriefTerms(route.searchQuery || lastUser, brief),
            aboutYou,
            brief,
            userName,
            channel.channelBlock,
            channel.nudge
          );

    // Ссылки на ролики в текущем сообщении: расшифровку добываем МЫ, а не человек.
    // ⚠️ Смотрим только последнее сообщение, а не всю историю: иначе каждый ответ в
    // длинном диалоге заново тянул бы ролики, о которых говорили полчаса назад.
    const videoIds = extractVideoIds(lastUser);

    // Веб-поиск: только на OpenRouter (плагин `web`), только если включён в админке,
    // и только на содержательных запросах — на «привет / спасибо» (category === "chat")
    // искать нечего, а каждый результат стоит денег (~$0.004).
    const webSearch =
      provider === "openrouter" &&
      settings.webSearch.enabled &&
      route.category !== "chat"
        ? settings.webSearch.maxResults
        : 0;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Пользователь нажал «Остановить» (или закрыл вкладку) → fetch отменён,
        // request.signal взводится. Прерываем генерацию, квоту НЕ списываем, но уже
        // сгенерированный кусок сохраняем в историю (он остался на экране).
        let closed = false;
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true; // клиент отвалился между чанками
          }
        };
        try {
          send(": ping\n\n");

          // Веб-поиск включён — говорим клиенту, чтобы индикатор показал «Ищу в
          // интернете» вместо обычной цепочки «думаю». Отдельное SSE-событие, а не
          // токен: до первого токена стрим и так молчит, а поиск заметно добавляет
          // к TTFT — без подписи это выглядит как «завис».
          if (webSearch > 0) send(`data: ${JSON.stringify({ searching: true })}\n\n`);

          // Ролик по ссылке: расшифровку тянет внешний сервис, это секунды, поэтому
          // сразу говорим клиенту показать «Разбираю видео» — как с веб-поиском,
          // иначе молчание до первого токена читается как «завис».
          let systemForRun = systemBlocks;
          if (videoIds.length > 0) {
            send(`data: ${JSON.stringify({ analyzingVideo: true })}\n\n`);
            // ⚠️ Ждём не дольше TRANSCRIPT_WAIT_MS: не успели — отвечаем без текста
            // ролика, а сервис дотянет расшифровку в кэш к следующему разу.
            const block = await Promise.race([
              buildVideoTranscriptBlock(videoIds),
              new Promise<string>((r) => setTimeout(() => r(""), TRANSCRIPT_WAIT_MS)),
            ]).catch(() => "");
            // Блок идёт ПОСЛЕДНИМ: модель сильнее весит то, что ближе к вопросу
            // (тот же recency-приём, что у ретрива знаний).
            if (block) systemForRun = [...systemBlocks, { type: "text" as const, text: block }];
          }

          // Стратегия провайдера: claude (Anthropic SDK, кэш/effort) или glm
          // (OpenAI-совместимый стрим). Обе отдают текстовые дельты.
          const strategy = getStrategy(provider);
          let assistantText = "";
          for await (const token of strategy.stream({
            system: systemForRun,
            messages,
            route,
            routeMs,
            model: settings.openrouterModel,
            orParams: settings.openrouterParams,
            orProvider: settings.openrouterProvider,
            webSearch,
            meta: { userId: sessionUser.id, conversationId },
          })) {
            if (request.signal.aborted) break;
            assistantText += token;
            send(`data: ${JSON.stringify({ token })}\n\n`);
          }

          const stopped = request.signal.aborted;
          if (stopped) {
            console.log(
              `[chat] stopped by user after ${assistantText.length} chars — квота не списана`
            );
          }

          // Успешный ответ — списываем 1 единицу квоты (kind=chat = 1 запрос).
          // Остановленную генерацию не тарифицируем (см. выше). Атомарный
          // increment; админам не списываем (гейт их и не проверяет).
          // Fire-and-forget: сбой счётчика не должен ронять уже отданный ответ.
          if (!stopped && assistantText.trim() && !isAdmin(sessionUser)) {
            prisma.user
              .update({
                where: { id: sessionUser.id },
                data: { requestsUsed: { increment: 1 } },
              })
              .catch((err) => console.error("[chat] requestsUsed increment error:", err));
          }

          // Геймификация: засчитываем действие (docs/achievements.md).
          // Fire-and-forget, админов тоже считаем — ачивки не про биллинг.
          if (!stopped && assistantText.trim()) track(sessionUser.id, "chat_message");

          // Успешный ответ — дописываем пару «вопрос+ответ» в историю. Вложенный
          // create обновляет диалог (триггерит @updatedAt → свежие сверху).
          // Ошибку записи глотаем: ответ уже у пользователя, история вторична.
          if (persistId && assistantText.trim()) {
            prisma.conversation
              .update({
                where: { id: persistId },
                data: {
                  messages: {
                    create: [
                      { role: "user", content: lastUserContent },
                      { role: "assistant", content: assistantText },
                    ],
                  },
                },
              })
              .catch((err) => console.error("[chat] persist messages error:", err));
          }

          send("data: [DONE]\n\n");
          try {
            controller.close();
          } catch {
            /* уже закрыт обрывом клиента */
          }
        } catch (err) {
          console.error("Stream error:", err);
          // Проект существует независимо от ответа (его создал бриф) — чистить нечего.
          send(`data: ${JSON.stringify({ error: "Ошибка генерации ответа" })}\n\n`);
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const message =
      error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
