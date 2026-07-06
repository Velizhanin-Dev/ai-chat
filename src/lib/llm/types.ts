import type Anthropic from "@anthropic-ai/sdk";
import type { RouteDecision } from "../router";

// Провайдер модели. ГЛОБАЛЬНЫЙ выбор: настраивается в админке и хранится в
// AppSetting.provider (см. src/lib/settings.ts), применяется ко всем юзерам — и в
// чате, и при генерации заголовка. Стратегии — в claude.ts / glm.ts.
export type LlmProvider = "claude" | "glm" | "openrouter";

export interface StreamArgs {
  // Системный промпт собран в route.ts как массив блоков Anthropic (с кэш-точками).
  // Claude использует его как есть; GLM/OpenRouter склеивают `.text` в один system-месседж.
  system: Anthropic.TextBlockParam[];
  messages: { role: "user" | "assistant"; content: string }[];
  route: RouteDecision;
  routeMs: number;
  // Модель для провайдеров с выбором модели (OpenRouter). Claude/GLM берут свою из env.
  model?: string;
  // Атрибуция для телеметрии (Stat): кто и в каком диалоге. Стратегия пишет
  // статистику сама после подсчёта стоимости (см. recordStat).
  meta?: { userId?: string | null; conversationId?: string | null };
}

export interface LlmStrategy {
  readonly provider: LlmProvider;
  // Стримит текстовые дельты ответа. Логирование стоимости/латентности — внутри
  // самой стратегии (метрики у провайдеров разные).
  stream(args: StreamArgs): AsyncGenerator<string, void, unknown>;
}
