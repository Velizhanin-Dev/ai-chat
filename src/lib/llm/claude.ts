import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "../anthropic";
import { recordStat } from "../stats";
import type { LlmStrategy, StreamArgs } from "./types";

// Opus 4.8 — единственная модель, что стабильно держит роль (Sonnet/Haiku
// сваливаются в «гптшный» тон на длинной генерации). Поддерживает только adaptive
// thinking — фиксированный budget_tokens возвращает 400. Глубину «размышлений» (и
// расход выходных токенов) регулируем через effort.
const MODEL_ID = "claude-opus-4-8";
const EFFORT: "low" | "medium" | "high" | "max" = "high";
const MAX_TOKENS = 16000;

// Haiku 4.5 — дешёвая модель для служебных вызовов (роутер знаний, заголовок
// диалога). Тарифы $/M: вход $1 / выход $5 (кэш на этих вызовах не используем).
export const HAIKU_MODEL = "claude-haiku-4-5";
export function haikuCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 1 + outputTokens * 5) / 1_000_000;
}

export const claudeStrategy: LlmStrategy = {
  provider: "claude",
  async *stream({ system, messages, route, routeMs, meta }: StreamArgs) {
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
    // ходу вся переписка читается из кэша (×0.1). TTL по умолчанию (5 мин).
    // Мультимодальный ход (вложения чата) — конвертируем куски OpenAI-формата в
    // блоки Anthropic: image_url(data-URL) → image/base64, file → document.
    const toBlocks = (
      parts: Exclude<StreamArgs["messages"][number]["content"], string>
    ): Anthropic.ContentBlockParam[] =>
      parts.flatMap((p): Anthropic.ContentBlockParam[] => {
        if (p.type === "text") return [{ type: "text", text: p.text }];
        if (p.type === "image_url") {
          const m2 = /^data:([\w/+.-]+);base64,(.+)$/.exec(p.image_url.url);
          if (!m2) return [];
          return [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: m2[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: m2[2],
              },
            },
          ];
        }
        const doc = /^data:application\/pdf;base64,(.+)$/.exec(p.file.file_data);
        if (!doc) return [];
        return [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: doc[1] },
          },
        ];
      });

    const cachedMessages: Anthropic.MessageParam[] = messages.map((m, i) =>
      i === messages.length - 1
        ? {
            role: m.role,
            content:
              typeof m.content === "string"
                ? [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }]
                : toBlocks(m.content),
          }
        : {
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : m.content
                    .map((p) => (p.type === "text" ? p.text : "[приложен файл]"))
                    .join("\n"),
          }
    );

    const t0 = Date.now();
    const anthropicStream = getAnthropic().messages.stream({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      ...thinkCfg,
      system,
      messages: cachedMessages,
    });

    let firstTokenAt = 0;
    for await (const event of anthropicStream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        if (!firstTokenAt) firstTokenAt = Date.now();
        yield event.delta.text;
      }
    }

    const finalMessage = await anthropicStream.finalMessage();
    const u = finalMessage.usage;
    const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
    const total = Date.now() - t0;
    // Оценка стоимости запроса (Opus 4.8, $/M токенов). cache_create считаем по
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
      `[chat] provider=claude model=${finalMessage.model} effort=${route.category === "chat" ? "off" : EFFORT} route=${route.category} routeMs=${routeMs} stop=${finalMessage.stop_reason} ttft=${ttft}ms total=${total}ms cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens} output=${u.output_tokens} cost=$${cost.toFixed(4)}`
    );

    // Телеметрия в БД (для дашборда). Fire-and-forget — на ответ не влияет.
    recordStat({
      kind: "chat",
      provider: "claude",
      model: finalMessage.model,
      userId: meta?.userId,
      conversationId: meta?.conversationId,
      routeCategory: route.category,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cachedTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: (u.cache_creation_input_tokens ?? 0),
      costUsd: cost,
      latencyMs: total,
    });
  },
};
