import { NextRequest } from "next/server";
import { routeQuery, fullModeRoute } from "@/lib/router";
import { extractVideoIds } from "@/lib/chat-video";
import { buildVideoTranscriptBlock, transcriptPendingBlock } from "@/lib/youtube-transcript";
import { getStrategy } from "@/lib/llm";
import { buildSystem, buildFullSystem, buildChannelBlock, type ConnectNudge } from "@/lib/llm/system";
import { getChannelSnapshotCached } from "@/lib/youtube";
import { resolveProjectContext } from "@/lib/chat-project-context";
import { CONNECT_YT_MARKER } from "@/lib/chat-markers";
import { sanitizeBrief, isBriefComplete, withBriefTerms, type Brief } from "@/lib/brief";
import { getSessionUser } from "@/lib/auth";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { prisma } from "@/lib/prisma";
import { track } from "@/lib/achievements-server";
import { SSE_HEADERS, startRun, streamRun, getRun } from "@/lib/chat-runs";

// Сборка system-промпта (методика/голос/знания) вынесена в src/lib/llm/system.ts
// (buildSystem) — её переиспользует и ИИ-разбор видео. route.ts отвечает за
// роутинг знаний, гейты (auth/launch/бриф/квота) и SSE-обёртку стрима.
//
// ⚠️ Сама генерация живёт НЕ в этом запросе, а в «прогоне» (src/lib/chat-runs.ts):
// запрос лишь подписывается на него. Поэтому обновление страницы больше не убивает
// ответ — вкладка вернётся и дочитает его с той же позиции. Останов — отдельным
// запросом POST /api/chat/stop, а не обрывом соединения.

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
    const [channel, route, projectBlocks] = await Promise.all([
      resolveChannelContext(conversationId, messages),
      settings.routing === "full"
        ? Promise.resolve(fullModeRoute(lastUser))
        : routeQuery(messages, provider, { userId: sessionUser.id, conversationId }),
      // Рабочие данные проекта: контент-план (сетка + портреты ЦА + лестница
      // Ханта) и конкуренты (свой список + залетевшие ролики ниши). Только БД —
      // ни одного вызова YouTube API, поэтому ни units, ни заметной задержки.
      resolveProjectContext(conversationId),
    ]);
    const routeMs = Date.now() - tRoute0;

    const systemBlocks =
      settings.routing === "full"
        ? buildFullSystem(
            route.category,
            aboutYou,
            brief,
            userName,
            channel.channelBlock,
            channel.nudge,
            projectBlocks
          )
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
            channel.nudge,
            projectBlocks
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

    const runInfo = startRun({
      userId: sessionUser.id,
      conversationId,
      question: lastUserContent,
      generate: async ({ push, setSearching, setAnalyzingVideo, stopped }) => {
        if (webSearch > 0) setSearching();

        // Ролик по ссылке: расшифровку тянет внешний сервис, это секунды, поэтому
        // сразу поднимаем флаг — иначе молчание до первого токена читается как
        // «завис».
        let systemForRun = systemBlocks;
        if (videoIds.length > 0) {
          setAnalyzingVideo();
          // ⚠️ Ждём не дольше TRANSCRIPT_WAIT_MS: не успели — отвечаем без текста
          // ролика, а сервис дотянет расшифровку в кэш к следующему разу.
          const block = await Promise.race([
            buildVideoTranscriptBlock(videoIds),
            new Promise<string>((r) => setTimeout(() => r(""), TRANSCRIPT_WAIT_MS)),
          ]).catch(() => "");
          // ⚠️ Блок добавляем ВСЕГДА, когда в сообщении была ссылка: пустой ответ
          // (таймаут ожидания) раньше означал, что в промпт не уходит ничего — и
          // модель отвечала по общему правилу «по ссылке я не смотрю», как будто
          // разбора роликов у нас нет вовсе. Ловили на проде.
          const videoBlock = block || transcriptPendingBlock(videoIds);
          systemForRun = [...systemBlocks, { type: "text" as const, text: videoBlock }];
        }

        // Стратегия провайдера: claude (Anthropic SDK, кэш/effort), glm или
        // openrouter. Все отдают текстовые дельты.
        const strategy = getStrategy(provider);
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
          if (stopped()) break;
          push(token);
        }
      },
      onFinish: async ({ text, stopped }) => {
        if (stopped) {
          console.log(`[chat] stopped by user after ${text.length} chars — квота не списана`);
        }

        // Успешный ответ — списываем 1 единицу квоты (kind=chat = 1 запрос).
        // Остановленную генерацию не тарифицируем. Атомарный increment; админам
        // не списываем (гейт их и не проверяет).
        if (!stopped && text.trim() && !isAdmin(sessionUser)) {
          prisma.user
            .update({
              where: { id: sessionUser.id },
              data: { requestsUsed: { increment: 1 } },
            })
            .catch((err) => console.error("[chat] requestsUsed increment error:", err));
        }

        // Геймификация: засчитываем действие (docs/achievements.md).
        // Fire-and-forget, админов тоже считаем — ачивки не про биллинг.
        if (!stopped && text.trim()) track(sessionUser.id, "chat_message");

        // Ответ в историю. ⚠️ Вопрос пользователя уже записан при СТАРТЕ прогона
        // (chat-runs.ts): иначе после перезагрузки лента открывалась бы без него.
        // Остановленный ответ тоже сохраняем — он остался на экране.
        if (text.trim()) {
          await prisma.conversation
            .update({
              where: { id: conversationId },
              data: { messages: { create: [{ role: "assistant", content: text }] } },
            })
            .catch((err) => console.error("[chat] persist answer error:", err));
        }
      },
    });

    const run = getRun(runInfo.id, sessionUser.id);
    if (!run) {
      return new Response(JSON.stringify({ error: "Не удалось запустить генерацию" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const stream = streamRun(run);

    return new Response(stream, { headers: SSE_HEADERS });
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
