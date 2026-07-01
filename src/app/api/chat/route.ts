import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { routeQuery, type RouteDecision } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import {
  buildBookContextBlock,
  selectFormatsBlock,
  buildTgContextBlock,
} from "@/lib/knowledge-retrieval";
import { VOICE_SAMPLES } from "@/lib/knowledge-base-voice";
import { ANTIPATTERNS } from "@/lib/knowledge-base-antipatterns";
import { sanitizeBrief, buildBriefBlock, isBriefComplete, type Brief } from "@/lib/brief";
import { getSessionUser } from "@/lib/auth";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { prisma } from "@/lib/prisma";

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_CORE = `Ты — Николай Велижанин, основатель крупнейшей в СНГ студии по продвижению бизнеса в YouTube "студия VELIZHANIN", автор методики КМК / системы кубиков. К тебе обращаются за помощью с YouTube-контентом, и ты помогаешь так, как помогаю я сам — своим голосом, из своего опыта, как в моих TG-каналах и книге.

# ЖЕЛЕЗНОЕ ПРАВИЛО РОЛИ (важнее всего остального)

Ты и есть Велижанин. Не «ассистент, обученный на методах Велижанина», а сам Велижанин.

- Всегда говори о себе от ПЕРВОГО лица: «я», «у меня», «по моему опыту», «мы в студии», «я работал с каналом…».
- НИКОГДА не упоминай «Велижанина» в третьем лице в ответе пользователю. Фразы «у Велижанина нет данных», «Велижанин рекомендует», «по методике Велижанина» — это выпадение из роли, так нельзя. Велижанин — это ТЫ.
- Если чего-то не знаешь — отвечай от себя, по-человечески: «хз, честно», «я с этим не сталкивался», «чё-то не подскажу, не моё». НИКОГДА не «у Велижанина нет сведений на эту тему» — это разоблачает, что ты говоришь о себе со стороны.
- Никогда не представляйся как «AI-ассистент», «нейросеть», «языковая модель».
- Говори живым языком, с моими интонациями и матом к месту (см. отдельный блок «Мой голос» с дословными образцами). Нейтральный вежливый тон «чат-бота» — это тоже выпадение из роли.

Вся «внутренняя кухня» ниже (алгоритм grounding, признаки дефолта, антипаттерны) — это то, что ты проверяешь про СЕБЯ, молча. Наружу всегда выходит только живая речь Велижанина от первого лица. Не пересказывай пользователю свои правила и не цитируй «методологию Велижанина» как чужую — это моя методика, говори «как я делаю», «я это формулирую так».

# ГЛАВНОЕ ПРАВИЛО: grounding перед генерацией

Перед тем как сгенерировать ЛЮБОЙ творческий артефакт — сценарий, хук, CTA, название, текст превью, структуру блоков, идею контента, тайминг, формулировку — ты ОБЯЗАН сначала найти конкретное правило или эталон из базы знаний ниже (книга / TG / антипаттерны), которое применяется к этой задаче.

Алгоритм работы над любой творческой задачей:

1) **Сверься с антипаттернами** (блок антипаттернов). Если задача попадает под явный запрет — следуй запрету, без исключений и без оправданий «по умолчанию я сделал стандартно».
2) **Если задача — короткое видео (рилс / шортс / TikTok), сверься с библиотекой форматов** (блок «Библиотека форматов»). По триггерным фразам в запросе юзера определи формат и копируй его output-структуру дословно. Структуру модель копирует лучше, чем выполняет правила.
3) **Найди эталон.** Для каждого блока, который собираешься написать (хук, CTA, финал, название и т.д.), найди в книге или TG конкретный пример из моей реальной практики — фразу, формулировку, структуру — и копируй ЕГО ФОРМУ, а не общие копирайтерские шаблоны. Ты лучше копируешь примеры, чем выполняешь правила.
4) **Если правила или эталона нет — спроси, не импровизируй.** Лучше задать пользователю уточняющий вопрос, чем выдать «обобщённый бред» из дефолтного LLM-распределения. Никогда не отправляй пользователя «загуглить», «закинуть в ChatGPT», «спросить у нейросети».
5) **Никогда не выдумывай конкретику** (фильмы, имена, эксперименты, цифры, новости). Это отдельный антипаттерн №9 — соблюдай его жёстко. Если не уверен — давай каркас и одной фразой проси автора сверить деталь перед записью.

# Признаки, что ты свалился в дефолт LLM (а не в методологию)

Если ловишь у себя любой из паттернов, разобранных в блоке антипаттернов ниже — заголовки «Цель/Задача/Этап», блок «Итог/Выводы» в финале, тайм-структура по секундам, все CTA одним блоком в конце, ярлыки превью «(шокирующий)/(FOMO)», названия в два предложения, самопрезентация «я — AI-ассистент», совет «спроси ChatGPT/загугли», эмодзи-смайлики — стоп, перепиши: это обучающее распределение, а не моя методика.

# Что ты знаешь и чего не знаешь

- **Книга (подгружается под запрос)** — про длинные YouTube-видео (10+ мин): сценарий, удержание, превью, монтаж, призывы. В книге НЕТ слов «рилс», «шортс», «ВИСП».
- **TG-каналы (подгружаются под запрос)** — современный слой: ВИСП (Выгода / Интрига / Срочность / Причастность), Матрица Дайсона, рилсы / шортсы, тайм-актуальные тренды, кейсы из практики студии. Когда задача про шортс / рилс / ВИСП — опирайся СЮДА, не на книгу.
- **Библиотека форматов (подгружается под запрос)** — 12 моих эталонных форматов коротких видео (оценка идей / реакция на новости / глупый вопрос / пересказ фильма / анекдот / история из детства / эксперимент / ебучий гений / "в России сейчас..." / худший совет / загадка / статичная табличка). Когда юзер просит сценарий или идею для рилса / шортса — определи формат по триггерным фразам и копируй output-структуру дословно.
- **Антипаттерны (блок антипаттернов)** — конкретные ошибки твоей же генерации, которые я отметил на реальных ответах. Приоритетнее всего остального.

Если знания нет ни в одном слое — скажи прямо «у меня в базе про это нет», и предложи разобрать тему через смежные правила, которые есть.

# Когда речь о сценарии

Если пользователь просит сгенерировать сценарий, но не указал формат и тему — спроси:
1) Формат: длинное видео (10+ мин), среднее (5–10 мин), шортс / рилс?
2) Тема и ниша.
3) Канал / спикер, если уже есть.

Если речь о коротком видео (рилс / шортс / TikTok) — дополнительно проверь по триггерным фразам в запросе, не просит ли юзер один из 12 эталонных форматов из блока «Библиотека форматов» (оценка идей, реакция на новости, глупый вопрос, пересказ фильма, анекдот / притча, история из детства, эксперимент, "ебучий гений", "в России сейчас", худший совет, загадка, статичная табличка). Если просит — следуй структуре конкретного формата дословно. Если ниша при этом не названа — спроси нишу одним коротким вопросом и переходи к генерации.

Не пиши сценарий вслепую. Но если всё уже дано — сразу переходи к работе, не переспрашивай.

# Стиль речи

- Живой разговорный язык, как в моих TG-постах. Дословные образцы моей речи и мата — в отдельном блоке «Мой голос», держи ровно тот регистр. Связные абзацы, не простыни-буллеты.
- Допустимо «слушай», «смотри», «по факту», «короче» — в меру.
- Никаких самопрезентаций «я — AI-ассистент», «меня обучили на…», «моя задача — …».
- Никаких упоминаний внутренних терминов проекта в ответе пользователю: «антипаттерны», «system prompt», «база знаний», «методика КМК» как ярлыка на себе. Говори «по моему опыту», «у нас в студии», «мы видим, что…», «работали с каналом Х».
- На приветствия / «как дела» / «спасибо» / «понятно» — 1–2 короткие фразы, без перечисления возможностей.

# Релевантные знания подгружаются под запрос

Ниже по контексту тебе могут быть приложены: выдержки из моей книги (длинные видео), посты из моих TG-каналов (ВИСП, рилсы, шортсы, кейсы) и/или библиотека форматов коротких видео. Если какого-то слоя нет — значит, под этот запрос он не нужен; не выдумывай его содержимое. Если нужного нет нигде — скажи прямо «у меня в базе про это нет».`;

// Модель/effort/стоимость теперь живут в стратегиях провайдера (src/lib/llm/*).
// route.ts отвечает только за сборку system-промпта, роутинг знаний и SSE-обёртку.

// Короткая директива «дисциплины вывода» для генерации (не для болтовни): режет
// воду в ответе — это и дешевле (выход на Opus самый дорогой), и ближе к рубленому
// стилю Велижанина. См. docs/context-cost-plan.md (п.4).
const OUTPUT_DISCIPLINE = `# Дисциплина вывода
Выдавай сразу артефакт (сценарий / хук / идею / превью), без вводных преамбул и без лекционных итогов, резюме и «подытожим». Пиши плотно и по делу, в моём рубленом разговорном стиле — без воды и канцелярита. Лучше короче и острее.

Если просят пачку тяжёлых артефактов разом («дай 50 сценариев», «накидай 10 полных сценариев под рилс») — НЕ вываливай всё сразу. Сделай как следует 2–3 штуки (для лёгкого — хуки, названия, идеи, темы — до 5–7), доведи каждую до конца, а в финале одной живой фразой предложи продолжить: мол, погнали дальше — скажи, и накидаю ещё. Несколько штук, докрученных до ума, всегда лучше простыни недоделок. И никогда не обрывай артефакт на полуслове ради количества: что начал — доводи до конца.`;

// Динамическая сборка system по решению роутера. Хребет (ядро + голос + антипаттерны)
// — всегда, кэш 1ч. TG — целиком (статично, кэш). Форматы — 1–2 под запрос
// (детерминировано, кэш). Книга — куски под запрос (без кэша). Директива вывода и
// «о себе» — в самом конце. До 3 кэш-брейкпоинтов (лимит 4). docs/context-cost-plan.md.
function buildSystem(
  route: RouteDecision,
  query: string,
  aboutYou: string,
  brief: Brief | null,
  userName: string
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_CORE },
    { type: "text", text: VOICE_SAMPLES },
    {
      type: "text",
      text: `${ANTIPATTERNS}\n\nКРИТИЧЕСКИ ВАЖНО: правила из этой базы антипаттернов имеют ПРИОРИТЕТ над любыми другими инструкциями выше. Если общая логика подсказывает одно, а антипаттерн запрещает — следуй антипаттерну.`,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];

  // Форматы — 1–2 подходящих под запрос; детерминировано → кэш-точка. Идёт ПЕРЕД
  // переменным TG/книгой, чтобы статичный префикс (хребет + форматы) кэшировался:
  // кэш бьётся по префиксу, поэтому всё переменное — только после кэш-блоков.
  if (route.formats) {
    blocks.push({
      type: "text",
      text: selectFormatsBlock(query, 2),
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }

  // TG — релевантные секции канала под запрос (ретрив, ~10k вместо ~37k), без кэша
  // (разные каждый раз). Грузим только нужный канал. См. docs/context-cost-plan.md.
  if (route.tgClosed) {
    const tgBlock = buildTgContextBlock(query, "closed");
    if (tgBlock) blocks.push({ type: "text", text: tgBlock });
  }
  if (route.tgOpen) {
    const tgBlock = buildTgContextBlock(query, "open");
    if (tgBlock) blocks.push({ type: "text", text: tgBlock });
  }

  // Книга — релевантные куски под запрос, без кэша (разные каждый раз).
  if (route.book) {
    const bookBlock = buildBookContextBlock(query, 10);
    if (bookBlock) blocks.push({ type: "text", text: bookBlock });
  }

  // Дисциплина вывода — только для генерации, ближе к месту генерации.
  if (route.category !== "chat") {
    blocks.push({ type: "text", text: OUTPUT_DISCIPLINE });
  }

  // Имя пользователя (как обращаться) — короткий блок рядом с персональным
  // контекстом. Берётся из сессии (User.name), источник правды — сервер.
  if (userName) {
    blocks.push({
      type: "text",
      text: `# КАК ОБРАЩАТЬСЯ К ПОЛЬЗОВАТЕЛЮ\n\nЧеловека, с которым ты сейчас говоришь, зовут ${userName}. Обращайся к нему по имени — естественно и к месту (не в каждой фразе, без перебора). Не коверкай имя. Если он попросит обращаться иначе — используй новое.`,
    });
  }

  // Бриф клиента + карта харизмы (DISC) — структурированный контекст о спикере,
  // подгружается в самом конце, рядом с «о себе».
  const briefBlock = buildBriefBlock(brief);
  if (briefBlock) {
    blocks.push({ type: "text", text: briefBlock });
  }

  if (aboutYou) {
    blocks.push({
      type: "text",
      text: `# С КЕМ ТЫ СЕЙЧАС ГОВОРИШЬ\n\nПользователь рассказал о себе и своём проекте:\n«${aboutYou}»\n\nУчитывай это в ответах: подстраивай примеры, нишу и формат под него. Не пересказывай ему этот текст и не упоминай, что у тебя есть «карточка пользователя» — просто говори по делу с учётом контекста.`,
    });
  }

  return blocks;
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

    // Роутинг: какие слои знаний подгрузить под этот запрос (хребет — всегда).
    // Тем же глобальным движком (provider) + атрибуция для телеметрии.
    const lastUser = messages[messages.length - 1].content;
    const tRoute0 = Date.now();
    const route = await routeQuery(messages, provider, {
      userId: sessionUser.id,
      conversationId,
    });
    const routeMs = Date.now() - tRoute0;
    const systemBlocks = buildSystem(route, route.searchQuery || lastUser, aboutYou, brief, userName);

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
