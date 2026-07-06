import { NextRequest } from "next/server";
import { routeQuery, fullModeRoute } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import { buildSystem, buildFullSystem } from "@/lib/llm/system";
import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";
import { getSessionUser } from "@/lib/auth";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { prisma } from "@/lib/prisma";

// Сборка system-промпта (методика/голос/знания) вынесена в src/lib/llm/system.ts
// (buildSystem) — её переиспользует и ИИ-разбор видео. route.ts отвечает за
// роутинг знаний, гейты (auth/launch/бриф/квота) и SSE-обёртку стрима.

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

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

    // Сборка знаний: два режима (глобальная настройка `routing`).
    //  • "full" — отдаём ВСЮ базу целиком, БЕЗ LLM-роутера (для моделей с кэшем
    //    контекста, напр. DeepSeek через OpenRouter): дешёвая эвристика категории +
    //    buildFullSystem. Экономит вызов роутера и даёт модели всё сразу.
    //  • "smart" — BM25-роутинг: классифицируем и подгружаем только релевантное.
    const lastUser = messages[messages.length - 1].content;
    const tRoute0 = Date.now();
    let route;
    let systemBlocks;
    if (settings.routing === "full") {
      route = fullModeRoute(lastUser);
      systemBlocks = buildFullSystem(route.category, aboutYou, brief, userName);
    } else {
      route = await routeQuery(messages, provider, {
        userId: sessionUser.id,
        conversationId,
      });
      systemBlocks = buildSystem(route, route.searchQuery || lastUser, aboutYou, brief, userName);
    }
    const routeMs = Date.now() - tRoute0;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));

          // Стратегия провайдера: claude (Anthropic SDK, кэш/effort) или glm
          // (OpenAI-совместимый стрим). Обе отдают текстовые дельты.
          const strategy = getStrategy(provider);
          let assistantText = "";
          for await (const token of strategy.stream({
            system: systemBlocks,
            messages,
            route,
            routeMs,
            model: settings.openrouterModel,
            meta: { userId: sessionUser.id, conversationId },
          })) {
            assistantText += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
            );
          }

          // Успешный ответ — списываем 1 единицу квоты (kind=chat = 1 запрос).
          // Атомарный increment; админам не списываем (гейт их и не проверяет).
          // Fire-and-forget: сбой счётчика не должен ронять уже отданный ответ.
          if (assistantText.trim() && !isAdmin(sessionUser)) {
            prisma.user
              .update({
                where: { id: sessionUser.id },
                data: { requestsUsed: { increment: 1 } },
              })
              .catch((err) => console.error("[chat] requestsUsed increment error:", err));
          }

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

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          // Проект существует независимо от ответа (его создал бриф) — чистить нечего.
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Ошибка генерации ответа" })}\n\n`
            )
          );
          controller.close();
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
