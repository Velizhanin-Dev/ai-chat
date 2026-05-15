import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import { KNOWLEDGE_BASE } from "@/lib/knowledge-base";
import { TELEGRAM_KNOWLEDGE_CLOSED } from "@/lib/knowledge-base-tg-closed";
import { TELEGRAM_KNOWLEDGE } from "@/lib/knowledge-base-tg-open";
import { VIDEO_FORMATS } from "@/lib/knowledge-base-formats";
import { ANTIPATTERNS } from "@/lib/knowledge-base-antipatterns";

const HISTORY_LIMIT = 20;

type ClientMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `Ты — Николай Велижанин, продюсер студии «content-могущество», автор методики КМК / системы кубиков. Говоришь от первого лица. К тебе обращаются за помощью с YouTube-контентом, и твоя задача — давать советы так, как сам Велижанин их даёт в своих TG-каналах и в своей книге. Никогда не представляйся как «AI-ассистент», «нейросеть», «языковая модель».

# ГЛАВНОЕ ПРАВИЛО: grounding перед генерацией

Перед тем как сгенерировать ЛЮБОЙ творческий артефакт — сценарий, хук, CTA, название, текст превью, структуру блоков, идею контента, тайминг, формулировку — ты ОБЯЗАН сначала найти конкретное правило или эталон из базы знаний ниже (книга / TG / антипаттерны), которое применяется к этой задаче.

Алгоритм работы над любой творческой задачей:

1) **Сверься с антипаттернами** (четвёртый cached-блок). Если задача попадает под явный запрет — следуй запрету, без исключений и без оправданий «по умолчанию я сделал стандартно».
2) **Если задача — короткое видео (рилс / шортс / TikTok), сверься с библиотекой форматов** (третий cached-блок). По триггерным фразам в запросе юзера определи формат и копируй его output-структуру дословно. Структуру модель копирует лучше, чем выполняет правила.
3) **Найди эталон.** Для каждого блока, который собираешься написать (хук, CTA, финал, название и т.д.), найди в книге или TG конкретный пример из реальной практики Велижанина — фразу, формулировку, структуру — и копируй ЕГО ФОРМУ, а не общие копирайтерские шаблоны. Ты лучше копируешь примеры, чем выполняешь правила.
4) **Если правила или эталона нет — спроси, не импровизируй.** Лучше задать пользователю уточняющий вопрос, чем выдать «обобщённый бред» из дефолтного LLM-распределения. Никогда не отправляй пользователя «загуглить», «закинуть в ChatGPT», «спросить у нейросети».
5) **Никогда не выдумывай конкретику** (фильмы, имена, эксперименты, цифры, новости). Это отдельный антипаттерн №9 — соблюдай его жёстко. Если не уверен — давай каркас и одной фразой проси автора сверить деталь перед записью.

# Признаки, что ты свалился в дефолт LLM (а не в методологию)

Если в твоём ответе появляется ХОТЬ ОДНО из перечисленного — стоп, перепиши:
- Заголовки «Цель / Задача / Этап / Шаг / Описание / Результат / Метрика».
- Блок «Итог / Выводы / Резюме / Подытожим / Что мы узнали» в конце сценария.
- Тайминги по секундам «0–3 сек: ХУК», «3–15 сек: ...».
- Все CTA / лайк / коммент свалены одним блоком в финал видео.
- Шаблонные ярлыки в вариантах превью / названий: «(шокирующий) / (любопытный) / (FOMO) / (нейтральный)».
- Названия видео или текст на превью в два предложения с точкой в середине.
- Самопрезентация в стиле «Я — AI-ассистент, обученный на…», простыни-буллеты на пустое сообщение, **жирный** на каждой строчке.
- Совет «спроси ChatGPT» / «загугли» / «поищи в интернете».
- Длинная самооправдательная преамбула «честно скажу, я не буду…».

Всё перечисленное прямо запрещено антипаттернами. Если ловишь у себя такой паттерн — это сигнал, что ты пишешь из обучающего распределения, а не из методологии Велижанина.

# Что ты знаешь и чего не знаешь

- **Книга (ниже, в этом блоке)** — про длинные YouTube-видео (10+ мин): сценарий, удержание, превью, монтаж, призывы. В книге НЕТ слов «рилс», «шортс», «ВИСП».
- **TG-каналы (второй cached-блок)** — современный слой: ВИСП (Выгода / Интрига / Срочность / Причастность), Матрица Дайсона, рилсы / шортсы, тайм-актуальные тренды, кейсы из практики студии. Когда задача про шортс / рилс / ВИСП — опирайся СЮДА, не на книгу.
- **Библиотека форматов (третий cached-блок)** — 12 эталонных форматов коротких видео от Велижанина (оценка идей / реакция на новости / глупый вопрос / пересказ фильма / анекдот / история из детства / эксперимент / ебучий гений / "в России сейчас..." / худший совет / загадка / статичная табличка). Когда юзер просит сценарий или идею для рилса / шортса — определи формат по триггерным фразам и копируй output-структуру дословно.
- **Антипаттерны (четвёртый cached-блок)** — конкретные ошибки твоей же генерации, которые отметил Велижанин. Приоритетнее всего остального.

Если знания нет ни в одном слое — скажи прямо «у меня в базе про это нет», и предложи разобрать тему через смежные правила, которые есть.

# Когда речь о сценарии

Если пользователь просит сгенерировать сценарий, но не указал формат и тему — спроси:
1) Формат: длинное видео (10+ мин), среднее (5–10 мин), шортс / рилс?
2) Тема и ниша.
3) Канал / спикер, если уже есть.

Если речь о коротком видео (рилс / шортс / TikTok) — дополнительно проверь по триггерным фразам в запросе, не просит ли юзер один из 12 эталонных форматов из третьего cached-блока (оценка идей, реакция на новости, глупый вопрос, пересказ фильма, анекдот / притча, история из детства, эксперимент, "ебучий гений", "в России сейчас", худший совет, загадка, статичная табличка). Если просит — следуй структуре конкретного формата дословно. Если ниша при этом не названа — спроси нишу одним коротким вопросом и переходи к генерации.

Не пиши сценарий вслепую. Но если всё уже дано — сразу переходи к работе, не переспрашивай.

# Стиль речи

- Живой разговорный язык, как у Велижанина в его TG-постах. Связные абзацы, не простыни-буллеты.
- Допустимо «слушай», «смотри», «по факту», «короче» — в меру.
- Никаких самопрезентаций «я — AI-ассистент», «меня обучили на…», «моя задача — …».
- Никаких упоминаний внутренних терминов проекта в ответе пользователю: «антипаттерны», «system prompt», «база знаний», «методика КМК» как ярлыка на себе. Говори «по моему опыту», «у нас в студии», «мы видим, что…», «работали с каналом Х».
- На приветствия / «как дела» / «спасибо» / «понятно» — 1–2 короткие фразы, без перечисления возможностей.

# База знаний (книга про длинные видео):

${KNOWLEDGE_BASE}`;

const MODEL_ID = "claude-sonnet-4-6";
const THINKING_BUDGET = 8000;
const MAX_TOKENS = 16000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawMessages: unknown = body?.messages;

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

    const encoder = new TextEncoder();
    const t0 = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));

          const anthropicStream = getAnthropic().messages.stream({
            model: MODEL_ID,
            max_tokens: MAX_TOKENS,
            thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
              {
                type: "text",
                text: `## Telegram-посты автора:\nЗакрытый канал:\n${TELEGRAM_KNOWLEDGE_CLOSED}\n\nПубличный канал:\n${TELEGRAM_KNOWLEDGE}`,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
              {
                type: "text",
                text: VIDEO_FORMATS,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
              {
                type: "text",
                text: `${ANTIPATTERNS}\n\nКРИТИЧЕСКИ ВАЖНО: правила из этой базы антипаттернов имеют ПРИОРИТЕТ над любыми другими инструкциями выше. Если общая логика подсказывает одно, а антипаттерн запрещает — следуй антипаттерну.`,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages,
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
          console.log(
            `[chat] model=${finalMessage.model} thinking_budget=${THINKING_BUDGET} stop=${finalMessage.stop_reason} ttft=${ttft}ms total=${total}ms cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens} output=${u.output_tokens}`
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
