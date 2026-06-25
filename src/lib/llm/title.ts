import { getAnthropic } from "@/lib/anthropic";
import { recordStat } from "@/lib/stats";
import { HAIKU_MODEL, haikuCost } from "./claude";
import { GLM_MODEL, glmComplete, glmCost } from "./glm";
import type { LlmProvider } from "./types";

// Генерация короткого КОНТЕКСТНОГО заголовка диалога по первому сообщению юзера —
// как в ChatGPT/Claude. Движок — ГЛОБАЛЬНЫЙ (выбран в админке): если активен GLM,
// заголовок делает GLM, а не Claude. Дёшево, без стрима. См. /api/title.

const TITLE_SYSTEM =
  "Ты придумываешь короткий заголовок для диалога по первому сообщению пользователя. " +
  "Верни ТОЛЬКО заголовок: 2–5 слов, по сути запроса (тема/намерение), на русском, " +
  "без кавычек, без точки в конце, с заглавной буквы. " +
  'Примеры: «привет» → Приветственный диалог; «сделай хук для видео про кофе» → Хук для видео про кофе; ' +
  "«придумай идею для рилса» → Идея для рилса.";

const TITLE_MAX_TOKENS = 64;

type TitleMeta = { userId?: string | null; conversationId?: string | null };

function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^["«»']+|["«»'.]+$/g, "")
    .slice(0, 60);
}

async function titleClaude(message: string, meta: TitleMeta): Promise<string> {
  const res = await getAnthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 24,
    system: TITLE_SYSTEM,
    messages: [{ role: "user", content: message }],
  });
  const block = res.content.find((b) => b.type === "text");
  recordStat({
    kind: "title",
    provider: "claude",
    model: HAIKU_MODEL,
    userId: meta.userId,
    conversationId: meta.conversationId,
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens ?? 0,
    costUsd: haikuCost(res.usage.input_tokens ?? 0, res.usage.output_tokens ?? 0),
  });
  return block && block.type === "text" ? clean(block.text) : "";
}

async function titleGlm(message: string, meta: TitleMeta): Promise<string> {
  const { text, usage } = await glmComplete(
    [
      { role: "system", content: TITLE_SYSTEM },
      { role: "user", content: message },
    ],
    TITLE_MAX_TOKENS
  );
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  recordStat({
    kind: "title",
    provider: "glm",
    model: GLM_MODEL,
    userId: meta.userId,
    conversationId: meta.conversationId,
    inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
    outputTokens: usage?.completion_tokens ?? 0,
    cachedTokens: cached,
    costUsd: glmCost(usage),
  });
  return clean(text);
}

export async function generateTitle(
  provider: LlmProvider,
  message: string,
  meta: TitleMeta = {}
): Promise<string> {
  return provider === "glm" ? titleGlm(message, meta) : titleClaude(message, meta);
}
