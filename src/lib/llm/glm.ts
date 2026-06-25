import { recordStat } from "../stats";
import type { LlmStrategy, StreamArgs } from "./types";

// GLM (Zhipu / Z.ai) — OpenAI-совместимый API. Ключ и эндпоинт берём из env.
// По умолчанию — международный домен z.ai; для bigmodel.cn поставь GLM_BASE_URL.
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4";
export const GLM_MODEL = process.env.GLM_MODEL || "glm-5.2";
const GLM_MAX_TOKENS = 16000;

// Тарифы ($/M токенов) для оценки стоимости в логах — GLM-5.2
// (docs.z.ai/guides/overview/pricing: вход $1.4 / выход $4.4 / кэш-вход $0.26).
// Кэш у GLM автоматический (implicit), попадания приходят в
// usage.prompt_tokens_details.cached_tokens и считаются по льготному тарифу.
const PRICE_INPUT = 1.4;
const PRICE_OUTPUT = 4.4;
const PRICE_CACHED_INPUT = 0.26;

export type GlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

// Стоимость вызова GLM по usage ($). Кэш-попадания — по льготному тарифу.
export function glmCost(usage: GlmUsage | null | undefined): number {
  if (!usage) return 0;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = Math.max(0, prompt - cached);
  return (fresh * PRICE_INPUT + cached * PRICE_CACHED_INPUT + completion * PRICE_OUTPUT) / 1_000_000;
}

// Нестриминговый вызов (заголовок диалога, роутер): мысли отключаем (иначе съели
// бы бюджет и оставили content пустым). messages включают system первым элементом.
export async function glmComplete(
  messages: { role: string; content: string }[],
  maxTokens: number
): Promise<{ text: string; usage: GlmUsage | null }> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) throw new Error("GLM не настроен: задай GLM_API_KEY");
  const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GLM_MODEL,
      max_tokens: maxTokens,
      stream: false,
      thinking: { type: "disabled" },
      messages,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`GLM API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: GlmUsage;
  };
  return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage ?? null };
}

export const glmStrategy: LlmStrategy = {
  provider: "glm",
  async *stream({ system, messages, route, routeMs, meta }: StreamArgs) {
    const apiKey = process.env.GLM_API_KEY;
    if (!apiKey) {
      throw new Error("GLM не настроен: задай GLM_API_KEY (и при необходимости GLM_BASE_URL / GLM_MODEL)");
    }

    // Системные блоки Anthropic (с кэш-точками) → один system-месседж OpenAI-формата.
    // cache_control GLM игнорирует — берём только текст.
    const systemText = system
      .map((b) => b.text)
      .filter((t) => typeof t === "string" && t.length)
      .join("\n\n");

    const oaMessages = [
      ...(systemText ? [{ role: "system" as const, content: systemText }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const t0 = Date.now();
    const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        messages: oaMessages,
        stream: true,
        max_tokens: GLM_MAX_TOKENS,
      }),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`GLM API ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenAt = 0;
    let outChars = 0;
    // usage GLM возвращает в последнем чанке стрима (choices пустой, есть usage).
    // Ловим оппортунистически — из любого чанка, где он есть.
    let usage: GlmUsage | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE: события разделены \n; держим неполную хвостовую строку в буфере.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let parsed: {
          choices?: { delta?: { content?: string } }[];
          usage?: GlmUsage;
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          // битый/частичный чанк — пропускаем (хвост уже сохранён в buffer)
          continue;
        }
        if (parsed.usage) usage = parsed.usage;
        // Берём только content. reasoning_content (если модель «думает») не
        // показываем — наружу идёт чистый ответ, как у claude-стратегии.
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          outChars += delta.length;
          yield delta;
        }
      }
    }

    const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
    const total = Date.now() - t0;

    // Стоимость: prompt_tokens = весь вход (включая кэш-попадания); кэшированные
    // считаем по льготному тарифу, остальное — по полному. Если usage не пришёл —
    // фолбэк на outChars (без $).
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      const cost = glmCost(usage);
      console.log(
        `[chat] provider=glm model=${GLM_MODEL} route=${route.category} routeMs=${routeMs} ttft=${ttft}ms total=${total}ms cached=${cached} input=${promptTokens} output=${completionTokens} cost=$${cost.toFixed(4)}`
      );
      recordStat({
        kind: "chat",
        provider: "glm",
        model: GLM_MODEL,
        userId: meta?.userId,
        conversationId: meta?.conversationId,
        routeCategory: route.category,
        // promptTokens у GLM включает кэш-попадания; cachedTokens выделяем отдельно.
        inputTokens: Math.max(0, promptTokens - cached),
        outputTokens: completionTokens,
        cachedTokens: cached,
        costUsd: cost,
        latencyMs: total,
      });
    } else {
      console.log(
        `[chat] provider=glm model=${GLM_MODEL} route=${route.category} routeMs=${routeMs} ttft=${ttft}ms total=${total}ms outChars=${outChars} (usage недоступен)`
      );
      // usage не пришёл — пишем сам факт запроса (без токенов/стоимости).
      recordStat({
        kind: "chat",
        provider: "glm",
        model: GLM_MODEL,
        userId: meta?.userId,
        conversationId: meta?.conversationId,
        routeCategory: route.category,
        latencyMs: total,
      });
    }
  },
};
