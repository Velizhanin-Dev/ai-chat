import { recordStat } from "../stats";
import type { LlmStrategy, StreamArgs } from "./types";

// OpenRouter — OpenAI-совместимый шлюз к сотням моделей (DeepSeek, Llama, Qwen, …).
// Модель выбирается в админке (settings.openrouterModel) и приходит в StreamArgs.model.
// Ключ — OPENROUTER_API_KEY. Каталог моделей — https://openrouter.ai/api/v1/models.
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
const OR_MAX_TOKENS = 16000;

// Ретраи/таймаут — как у GLM: OpenRouter/апстрим-провайдер тоже может отбить 429/5xx
// или подвиснуть до первого токена. Пока токенов нет — повтор невидим пользователю.
const OR_MAX_RETRIES = Math.max(0, Number(process.env.OPENROUTER_MAX_RETRIES ?? 3));
const OR_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENROUTER_TIMEOUT_MS ?? 60000));

function orSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function orBackoffMs(attempt: number): number {
  return Math.min(4000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
}
function orRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

interface OrUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  // OpenRouter кладёт стоимость запроса в USD сюда (если include_usage).
  cost?: number;
}

export const openrouterStrategy: LlmStrategy = {
  provider: "openrouter",
  async *stream({ system, messages, route, routeMs, meta, model }: StreamArgs) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter не настроен: задай OPENROUTER_API_KEY");
    }
    const useModel = (model && model.trim()) || OPENROUTER_DEFAULT_MODEL;

    // Блоки Anthropic (с кэш-точками) → один system-месседж OpenAI-формата.
    const systemText = system
      .map((b) => b.text)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .join("\n\n");
    const oaMessages = [
      ...(systemText ? [{ role: "system" as const, content: systemText }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const requestBody = JSON.stringify({
      model: useModel,
      messages: oaMessages,
      stream: true,
      max_tokens: OR_MAX_TOKENS,
      // Просим OpenRouter прислать usage (токены + cost) в финальном чанке.
      usage: { include: true },
    });

    const t0 = Date.now();
    let firstTokenAt = 0;
    let outChars = 0;
    let usage: OrUsage | null = null;

    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController();
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const armStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ac.abort(), OR_TIMEOUT_MS);
      };
      const clearStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = null;
      };
      armStall();

      let resp: Response;
      try {
        resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            // OpenRouter рекомендует для атрибуции трафика (необязательно).
            "HTTP-Referer": appUrl,
            "X-Title": "VELIZHANIN AI",
          },
          body: requestBody,
          signal: ac.signal,
        });
      } catch (netErr) {
        clearStall();
        const timedOut = ac.signal.aborted;
        if (attempt < OR_MAX_RETRIES) {
          console.warn(
            `[chat] provider=openrouter ${timedOut ? `timeout (${OR_TIMEOUT_MS}ms)` : "network error"}, retry ${attempt + 1}/${OR_MAX_RETRIES}`
          );
          await orSleep(orBackoffMs(attempt + 1));
          continue;
        }
        throw timedOut ? new Error(`OpenRouter timeout: нет ответа за ${OR_TIMEOUT_MS}ms`) : netErr;
      }

      if (!resp.ok || !resp.body) {
        clearStall();
        if (orRetryable(resp.status) && attempt < OR_MAX_RETRIES) {
          const ra = Number(resp.headers.get("retry-after"));
          const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : orBackoffMs(attempt + 1);
          console.warn(
            `[chat] provider=openrouter ${resp.status}, retry ${attempt + 1}/${OR_MAX_RETRIES} in ${waitMs}ms`
          );
          await resp.text().catch(() => "");
          await orSleep(waitMs);
          continue;
        }
        const errText = await resp.text().catch(() => "");
        throw new Error(`OpenRouter API ${resp.status}: ${errText.slice(0, 300)}`);
      }

      armStall();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            clearStall();
            break;
          }
          armStall();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let parsed: {
              choices?: { delta?: { content?: string } }[];
              usage?: OrUsage;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (parsed.usage) usage = parsed.usage;
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              outChars += delta.length;
              yield delta;
            }
          }
        }
      } catch (readErr) {
        clearStall();
        const timedOut = ac.signal.aborted;
        if (firstTokenAt === 0 && attempt < OR_MAX_RETRIES) {
          console.warn(
            `[chat] provider=openrouter stream ${timedOut ? `stalled (${OR_TIMEOUT_MS}ms)` : "broke"} before first token, retry ${attempt + 1}/${OR_MAX_RETRIES}`
          );
          await orSleep(orBackoffMs(attempt + 1));
          continue;
        }
        throw timedOut && firstTokenAt
          ? new Error(`OpenRouter stream stalled после ${OR_TIMEOUT_MS}ms без новых токенов`)
          : readErr;
      }
      clearStall();
      break;
    }

    const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
    const total = Date.now() - t0;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    // Стоимость OpenRouter отдаёт сам (usage.cost, USD) — цены разнятся по моделям.
    const cost = usage?.cost ?? 0;
    console.log(
      `[chat] provider=openrouter model=${useModel} route=${route.category} routeMs=${routeMs} ttft=${ttft}ms total=${total}ms cached=${cached} input=${promptTokens} output=${completionTokens} outChars=${outChars} cost=$${cost.toFixed(4)}`
    );
    recordStat({
      kind: "chat",
      provider: "openrouter",
      model: useModel,
      userId: meta?.userId,
      conversationId: meta?.conversationId,
      routeCategory: route.category,
      inputTokens: Math.max(0, promptTokens - cached),
      outputTokens: completionTokens,
      cachedTokens: cached,
      costUsd: cost,
      latencyMs: total,
    });
  },
};
