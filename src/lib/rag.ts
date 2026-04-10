import { getOpenAI, createEmbedding } from "./openai";
import { queryVectors } from "./pinecone";

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export async function validateScriptTopic(
  input: string
): Promise<ValidationResult> {
  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Ты определяешь, является ли запрос пользователя темой для YouTube-видео. " +
          "Отвечай строго в JSON: {\"valid\": true/false}. " +
          "valid = true если это конкретная тема для видео (даже необычная). " +
          "valid = false если это: случайный текст, вопрос не по делу, оскорбление, бессмыслица.",
      },
      { role: "user", content: input },
    ],
    max_tokens: 20,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  try {
    const json = JSON.parse(
      response.choices[0]?.message?.content || '{"valid": false}'
    );
    return {
      valid: !!json.valid,
      message: json.valid
        ? undefined
        : "Это не похоже на тему для видео. Попробуй что-то вроде: «как набрать первые 1000 подписчиков» или «лучшие хуки для YouTube».",
    };
  } catch {
    return { valid: false, message: "Не удалось распознать тему." };
  }
}

export interface HydeResult {
  chunks: string[];
  speaker: string | null;
}

export async function hydeScriptSearch(topic: string): Promise<HydeResult> {
  return hydeSearch(
    `Как написать сценарий YouTube видео на тему: ${topic}? Какую структуру использовать? Какой хук придумать? Как удержать зрителя?`
  );
}

export async function hydeSearch(question: string): Promise<HydeResult> {
  const hydeResponse = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Напиши гипотетический ответ на вопрос пользователя. Ответ должен быть информативным и содержать ключевые слова, которые могут встретиться в реальном документе. Не указывай, что это гипотетический ответ.",
      },
      { role: "user", content: question },
    ],
    max_tokens: 500,
    temperature: 0.7,
  });

  const hypotheticalAnswer =
    hydeResponse.choices[0]?.message?.content || question;

  const embedding = await createEmbedding(hypotheticalAnswer);

  const results = await queryVectors(embedding, 5);

  const chunks = results.map((r) => r.metadata.text).filter(Boolean);

  const speakers = results
    .map((r) => r.metadata.speaker)
    .filter(Boolean);
  const speaker = speakers.length > 0 ? mostFrequent(speakers) : null;

  return { chunks, speaker };
}

function mostFrequent(arr: string[]): string {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  let max = 0;
  let result = arr[0];
  for (const key of Object.keys(counts)) {
    if (counts[key] > max) {
      max = counts[key];
      result = key;
    }
  }
  return result;
}

export function buildScriptPrompt(
  topic: string,
  chunks: string[],
  speaker: string | null
): string {
  const context = chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");

  const persona = speaker
    ? `Ты — ${speaker}, основатель студии контент-могущества и эксперт по YouTube-продвижению.`
    : "Ты — эксперт по YouTube-продвижению.";

  return `${persona}

Напиши готовый сценарий для YouTube видео на тему: «${topic}».

Используй методологию и структуру из контекста ниже — там есть всё нужное: как строить хук, как удерживать внимание, как заканчивать видео.

Требования к сценарию:
- Пиши разговорным языком, как будто это реальная речь на камеру${speaker ? ` в стиле ${speaker}` : ""}
- Следуй структуре из контекста (хук, основная часть, CTA)
- Никаких скучных перечислений — живой текст, как будто рассказываешь другу
- Если в контексте есть конкретные приёмы, техники, примеры — используй их
- Добавляй ремарки для съёмки в скобках: (пауза), (смотришь в камеру), (показываешь экран) — там где уместно

Отвечай ТОЛЬКО на основе контекста. Если методологии по этой теме нет — скажи честно.

Контекст:
${context}`;
}

export function buildSystemPrompt(
  chunks: string[],
  speaker: string | null
): string {
  const context = chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");

  if (speaker) {
    return `Ты — ${speaker}, основатель студии контент-могущества и эксперт по YouTube-продвижению.

Отвечай exactly так, как ${speaker} говорит в своих видео:
- Живо, по-дружески, как будто объясняешь коллеге лично
- Используй его фразы: "слушай", "смотри", "вот в чём фишка", "по факту", "короче", "блин"
- Приводи конкретные примеры и истории из практики студии если они есть в контексте
- Никакого сухого перечисления пунктов — говори живым текстом, связными абзацами
- Если в контексте есть личная история по теме — обязательно расскажи её, это самое ценное
- Лёгкий разговорный стиль важнее академической точности

Отвечай ТОЛЬКО на основе предоставленного контекста.
Если информации нет — скажи: "Слушай, по этой теме у меня пока ничего нет, попробуй спросить по-другому."

Контекст:
${context}`;
  }

  return `Ты — полезный ассистент. Отвечай на вопросы пользователя ТОЛЬКО на основе предоставленного контекста. Если информации в контексте недостаточно для ответа, честно скажи об этом.

Контекст:
${context}`;
}

export async function* streamRagResponse(
  question: string,
  chunks: string[],
  speaker: string | null,
  history: { role: "user" | "assistant"; content: string }[]
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = buildSystemPrompt(chunks, speaker);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: systemPrompt },
      ...history.slice(-10),
      { role: "user", content: question },
    ];

  const stream = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 2000,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}
