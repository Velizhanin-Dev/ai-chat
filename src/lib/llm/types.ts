import type Anthropic from "@anthropic-ai/sdk";
import type { RouteDecision } from "../router";
import type { OpenRouterParams } from "./openrouter-params";

// Провайдер модели. ГЛОБАЛЬНЫЙ выбор: настраивается в админке и хранится в
// AppSetting.provider (см. src/lib/settings.ts), применяется ко всем юзерам — и в
// чате, и при генерации заголовка. Стратегии — в claude.ts / glm.ts.
export type LlmProvider = "claude" | "glm" | "openrouter";

// Кусок мультимодального сообщения (OpenAI-совместимый формат, его понимает
// OpenRouter как есть). Картинки и PDF кладутся data-URL'ами БАЗОЙ64 — файлы
// уже лежат у нас на диске, наружу ссылки не ходят.
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

// Ход диалога. content-строка — обычное текстовое сообщение (подавляющее
// большинство); массив кусков — ход с вложениями (только ПОСЛЕДНЕЕ сообщение
// пользователя: в историю вложения не тянем, см. chat-attachments.ts).
export interface ChatTurn {
  role: "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface StreamArgs {
  // Системный промпт собран в route.ts как массив блоков Anthropic (с кэш-точками).
  // Claude использует его как есть; GLM/OpenRouter склеивают `.text` в один system-месседж.
  system: Anthropic.TextBlockParam[];
  messages: ChatTurn[];
  route: RouteDecision;
  routeMs: number;
  // Модель для провайдеров с выбором модели (OpenRouter). Claude/GLM берут свою из env.
  model?: string;
  // Параметры генерации для OpenRouter (temperature/reasoning/…), заданные в админке.
  // Claude/GLM их игнорируют (у них свои настройки в стратегии).
  orParams?: OpenRouterParams;
  // Пин провайдера OpenRouter (slug). Заставляет все запросы идти в одного
  // провайдера → пер-провайдерный кэш DeepSeek греется. "" / undefined = авто.
  orProvider?: string;
  // Веб-поиск (плагин `web` OpenRouter). Число результатов — сколько запрашивать;
  // undefined / 0 = поиск выключен. Claude/GLM игнорируют (у них своих плагинов нет).
  // Платно (~$0.004 за результат), включается в админке. См. AppSettings.webSearch.
  webSearch?: number;
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
