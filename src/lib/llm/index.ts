import { claudeStrategy } from "./claude";
import { glmStrategy } from "./glm";
import type { LlmProvider, LlmStrategy } from "./types";

export type { LlmProvider, LlmStrategy, StreamArgs } from "./types";

const STRATEGIES: Record<LlmProvider, LlmStrategy> = {
  claude: claudeStrategy,
  glm: glmStrategy,
};

export function getStrategy(provider: LlmProvider): LlmStrategy {
  return STRATEGIES[provider] ?? claudeStrategy;
}

// Нормализация значения из тела запроса: только известные провайдеры, иначе claude.
export function normalizeProvider(value: unknown): LlmProvider {
  return value === "glm" ? "glm" : "claude";
}
