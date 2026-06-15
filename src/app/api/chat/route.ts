import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import type Anthropic from "@anthropic-ai/sdk";
import { routeQuery, type RouteDecision } from "@/lib/router";
import { buildBookContextBlock, selectFormatsBlock } from "@/lib/knowledge-retrieval";
import { TELEGRAM_KNOWLEDGE_CLOSED } from "@/lib/knowledge-base-tg-closed";
import { TELEGRAM_KNOWLEDGE } from "@/lib/knowledge-base-tg-open";
import { VOICE_SAMPLES } from "@/lib/knowledge-base-voice";
import { ANTIPATTERNS } from "@/lib/knowledge-base-antipatterns";

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_CORE = `Ты — Николай Велижанин, продюсер студии «content-могущество», автор методики КМК / системы кубиков. К тебе обращаются за помощью с YouTube-контентом, и ты помогаешь так, как помогаю я сам — своим голосом, из своего опыта, как в моих TG-каналах и книге.

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

const MODEL_ID = "claude-opus-4-8";
// Opus 4.8 — единственная модель, что стабильно держит роль (Sonnet/Haiku сваливаются
// в «гптшный» тон на длинной генерации). Поддерживает только adaptive thinking —
// фиксированный budget_tokens возвращает 400. Глубину «размышлений» (и расход выходных
// токенов) регулируем через effort. Пока high — качество, на котором тестировали роль;
// после ввода роутинга (Фаза 1, см. docs/context-cost-plan.md) effort станет свой на
// каждый тип запроса (off/low для болтовни, medium для генерации).
const EFFORT: "low" | "medium" | "high" | "max" = "high";
const MAX_TOKENS = 16000;

// Короткая директива «дисциплины вывода» для генерации (не для болтовни): режет
// воду в ответе — это и дешевле (выход на Opus самый дорогой), и ближе к рубленому
// стилю Велижанина. См. docs/context-cost-plan.md (п.4).
const OUTPUT_DISCIPLINE = `# Дисциплина вывода
Выдавай сразу артефакт (сценарий / хук / идею / превью), без вводных преамбул и без лекционных итогов, резюме и «подытожим». Пиши плотно и по делу, в моём рубленом разговорном стиле — без воды и канцелярита. Лучше короче и острее.`;

// Динамическая сборка system по решению роутера. Хребет (ядро + голос + антипаттерны)
// — всегда, кэш 1ч. TG — целиком (статично, кэш). Форматы — 1–2 под запрос
// (детерминировано, кэш). Книга — куски под запрос (без кэша). Директива вывода и
// «о себе» — в самом конце. До 3 кэш-брейкпоинтов (лимит 4). docs/context-cost-plan.md.
function buildSystem(
  route: RouteDecision,
  query: string,
  aboutYou: string
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

  // TG целиком — статично; кэш-точка после TG (общая для всех short-запросов).
  const tg: Anthropic.TextBlockParam[] = [];
  if (route.tgClosed) {
    tg.push({
      type: "text",
      text: `## Telegram-посты (закрытый канал):\n${TELEGRAM_KNOWLEDGE_CLOSED}`,
    });
  }
  if (route.tgOpen) {
    tg.push({
      type: "text",
      text: `## Telegram-посты (публичный канал):\n${TELEGRAM_KNOWLEDGE}`,
    });
  }
  if (tg.length > 0) {
    tg[tg.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
    blocks.push(...tg);
  }

  // Форматы — 1–2 подходящих под запрос; детерминировано → своя кэш-точка.
  if (route.formats) {
    blocks.push({
      type: "text",
      text: selectFormatsBlock(query, 2),
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
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

    // Роутинг: какие слои знаний подгрузить под этот запрос (хребет — всегда).
    const lastUser = messages[messages.length - 1].content;
    const tRoute0 = Date.now();
    const route = await routeQuery(messages);
    const routeMs = Date.now() - tRoute0;
    const systemBlocks = buildSystem(route, route.searchQuery || lastUser, aboutYou);
    // Болтовне глубокое мышление не нужно — отключаем (экономит выходные токены и
    // латентность). Генерация (short/long/method) — adaptive thinking + effort.
    const thinkCfg =
      route.category === "chat"
        ? { thinking: { type: "disabled" as const } }
        : {
            thinking: { type: "adaptive" as const },
            output_config: { effort: EFFORT },
          };

    // Кэшируем историю диалога: брейкпоинт на последнем сообщении → на следующем
    // ходу вся переписка читается из кэша (×0.1), а не по полной. Особенно дёшевы
    // правки сценария по ходу диалога. TTL по умолчанию (5 мин — ходы идут часто).
    const cachedMessages: Anthropic.MessageParam[] = messages.map((m, i) =>
      i === messages.length - 1
        ? {
            role: m.role,
            content: [
              { type: "text", text: m.content, cache_control: { type: "ephemeral" } },
            ],
          }
        : { role: m.role, content: m.content }
    );

    const encoder = new TextEncoder();
    const t0 = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));

          const anthropicStream = getAnthropic().messages.stream({
            model: MODEL_ID,
            max_tokens: MAX_TOKENS,
            ...thinkCfg,
            system: systemBlocks,
            messages: cachedMessages,
          });

          let firstTokenAt = 0;
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              const token = event.delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
              );
            }
          }

          const finalMessage = await anthropicStream.finalMessage();
          const u = finalMessage.usage;
          const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
          const total = Date.now() - t0;
          // Оценка стоимости запроса (Opus 4.8, $/M токенов). Роутер на Haiku —
          // отдельный мелкий вызов, в эту сумму не входит. cache_create считаем по
          // TTL: 1ч = 2× ($10), 5м = 1.25× ($6.25); чтение из кэша = 0.1× ($0.5).
          const cc1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
          const cc5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
          const cc1hEff =
            cc1h || Math.max(0, (u.cache_creation_input_tokens ?? 0) - cc5m);
          const cost =
            ((u.input_tokens ?? 0) * 5 +
              (u.output_tokens ?? 0) * 25 +
              (u.cache_read_input_tokens ?? 0) * 0.5 +
              cc1hEff * 10 +
              cc5m * 6.25) /
            1_000_000;
          console.log(
            `[chat] model=${finalMessage.model} effort=${route.category === "chat" ? "off" : EFFORT} route=${route.category} routeMs=${routeMs} stop=${finalMessage.stop_reason} ttft=${ttft}ms total=${total}ms cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens} output=${u.output_tokens} cost=$${cost.toFixed(4)}`
          );

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
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
