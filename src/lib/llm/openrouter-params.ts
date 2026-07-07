// Тюнинг-параметры генерации для OpenRouter. Админ задаёт их в /admin/flags под
// выбранной моделью; в запрос уходят только ЗАДАННЫЕ значения (незаданные не шлём).
// Показываем в UI только те крутилки, что модель реально поддерживает
// (supported_parameters из каталога OpenRouter); неподдерживаемое OpenRouter
// игнорирует сам. Чистый модуль (без prisma) — общий для клиента (UI) и сервера
// (валидация в settings/route + сборка тела запроса в стратегии openrouter).

export interface OpenRouterParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  top_a?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  seed?: number;
  // Глубина рассуждений (reasoning / «thinking»). Не задано → поведение модели по
  // умолчанию (для большинства DeepSeek/GLM — без рассуждений).
  reasoning?: "low" | "medium" | "high";
}

// Числовые «крутилки». key совпадает с именем параметра в supported_parameters
// OpenRouter — по нему же решаем, показывать ли контрол для выбранной модели.
export interface OrNumericSpec {
  key: Exclude<keyof OpenRouterParams, "reasoning">;
  label: string;
  min: number;
  max: number;
  step: number;
  int?: boolean;
}

export const OR_NUMERIC_PARAMS: OrNumericSpec[] = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.1 },
  { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.05 },
  { key: "top_k", label: "Top K", min: 0, max: 200, step: 1, int: true },
  { key: "min_p", label: "Min P", min: 0, max: 1, step: 0.01 },
  { key: "top_a", label: "Top A", min: 0, max: 1, step: 0.01 },
  { key: "frequency_penalty", label: "Frequency penalty", min: -2, max: 2, step: 0.1 },
  { key: "presence_penalty", label: "Presence penalty", min: -2, max: 2, step: 0.1 },
  { key: "repetition_penalty", label: "Repetition penalty", min: 0, max: 2, step: 0.05 },
  { key: "max_tokens", label: "Max tokens", min: 1, max: 200000, step: 256, int: true },
  { key: "seed", label: "Seed", min: 0, max: 2 ** 31 - 1, step: 1, int: true },
];

// Имя параметра reasoning в каталоге OpenRouter (supported_parameters) + допустимые
// уровни усилия.
export const OR_REASONING_KEY = "reasoning";
export const OR_REASONING_EFFORTS = ["low", "medium", "high"] as const;

function clampNum(v: unknown, spec: OrNumericSpec): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  let c = Math.min(spec.max, Math.max(spec.min, n));
  if (spec.int) c = Math.round(c);
  return c;
}

// Нормализуем «сырой» объект (из БД или тела запроса) к безопасному
// OpenRouterParams: только известные ключи, значения зажаты в диапазон, пустое
// отброшено. Доверять клиенту напрямую нельзя.
export function normalizeOpenRouterParams(raw: unknown): OpenRouterParams {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: OpenRouterParams = {};
  for (const spec of OR_NUMERIC_PARAMS) {
    const val = src[spec.key];
    if (val == null || val === "") continue;
    const v = clampNum(val, spec);
    if (v !== undefined) out[spec.key] = v;
  }
  const r = src.reasoning;
  if (r === "low" || r === "medium" || r === "high") out.reasoning = r;
  return out;
}

// Собираем фрагмент тела запроса OpenRouter из заданных параметров. reasoning
// разворачиваем в объект { effort } (единый reasoning-API OpenRouter). Ключи, что
// модель не поддерживает, OpenRouter игнорирует, поэтому фильтровать тут не нужно.
export function buildOrRequestParams(p: OpenRouterParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const spec of OR_NUMERIC_PARAMS) {
    const v = p[spec.key];
    if (typeof v === "number") body[spec.key] = v;
  }
  if (p.reasoning) body.reasoning = { effort: p.reasoning };
  return body;
}
