import type Anthropic from "@anthropic-ai/sdk";
import type { RouteDecision } from "../router";

// Провайдер модели. Переключается из чата (см. settingsSlice.provider) и едет в
// теле запроса `/api/chat` как `provider`. Стратегии — в claude.ts / glm.ts.
export type LlmProvider = "claude" | "glm";

export interface StreamArgs {
  // Системный промпт собран в route.ts как массив блоков Anthropic (с кэш-точками).
  // Claude использует его как есть; GLM склеивает `.text` в один system-месседж.
  system: Anthropic.TextBlockParam[];
  messages: { role: "user" | "assistant"; content: string }[];
  route: RouteDecision;
  routeMs: number;
}

export interface LlmStrategy {
  readonly provider: LlmProvider;
  // Стримит текстовые дельты ответа. Логирование стоимости/латентности — внутри
  // самой стратегии (метрики у провайдеров разные).
  stream(args: StreamArgs): AsyncGenerator<string, void, unknown>;
}
