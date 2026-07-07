import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import type { LlmProvider } from "./llm/types";
import {
  normalizeOpenRouterParams,
  type OpenRouterParams,
} from "./llm/openrouter-params";

// ── Глобальные настройки / фичефлаги ────────────────────────────────────────
// Источник правды — таблица AppSetting (key→JSON), правится из админки. Здесь —
// типизированный доступ с дефолтами: читаем серверно (лендинг, гейт брифа),
// отдаём клиенту только безопасный публичный срез (getPublicConfig). Серверный
// модуль (Prisma) — НЕ импортировать в клиентские компоненты.

export interface AppSettings {
  // Доступна ли анонимная страница брифа по QR (/brief). Выкл → 404.
  briefPageEnabled: boolean;
  // Движок модели для ВСЕХ пользователей (выбирается в админке, переключается
  // глобально). Используется и для ответов в чате, и для генерации заголовка.
  // Пользователь движок не выбирает (раньше был тумблер в чате — убран).
  provider: LlmProvider;
  // Модель OpenRouter (когда provider="openrouter"), напр. "deepseek/deepseek-chat".
  // Каталог тянется из OpenRouter API в админке. Для claude/glm — не используется.
  openrouterModel: string;
  // Режим сборки промпта: "smart" — наш BM25-роутинг знаний (подгружаем релевантное),
  // "full" — отдаём ВСЮ базу знаний целиком (для моделей с кэшированием контекста,
  // напр. DeepSeek через OpenRouter). Выбирается в админке рядом с OpenRouter.
  routing: "smart" | "full";
  // Параметры генерации OpenRouter (temperature/top_p/reasoning/…), заданные в
  // админке под выбранную модель. Только заданные уходят в запрос. Для claude/glm
  // не используются. См. src/lib/llm/openrouter-params.ts.
  openrouterParams: OpenRouterParams;
  // Пин провайдера OpenRouter (slug, напр. "deepseek"). OpenRouter по умолчанию
  // балансирует запросы между провайдерами модели — из-за чего пер-провайдерный
  // кэш DeepSeek не срабатывает (каждый запрос на другом провайдере = промах).
  // Пин шлёт `provider: { order: [slug], allow_fallbacks: false }` — все запросы в
  // одного провайдера, кэш греется. "" = авто-балансировка (без пина).
  openrouterProvider: string;
  // Режим «скоро запуск»: таймер в герое + скрытые тарифы на лендинге.
  launch: {
    countdownEnabled: boolean;
    // ISO-дата цели отсчёта (или null, если не задана).
    targetAt: string | null;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  briefPageEnabled: true,
  provider: "claude",
  openrouterModel: "",
  routing: "smart",
  openrouterParams: {},
  openrouterProvider: "",
  launch: { countdownEnabled: false, targetAt: null },
};

// Ключи строк в таблице AppSetting.
const KEY_BRIEF = "brief_page_enabled";
const KEY_LAUNCH = "launch";
const KEY_PROVIDER = "provider";
const KEY_OR_MODEL = "openrouter_model";
const KEY_OR_PARAMS = "openrouter_params";
const KEY_OR_PROVIDER = "openrouter_provider";
const KEY_ROUTING = "routing";

function normalizeProviderValue(v: unknown): LlmProvider {
  return v === "glm" || v === "openrouter" ? v : "claude";
}

// Нормализация «сырых» JSON-значений из БД к типу AppSettings (с дефолтами).
function normalize(map: Map<string, unknown>): AppSettings {
  const brief = map.get(KEY_BRIEF);
  const provider = map.get(KEY_PROVIDER);
  const orModel = map.get(KEY_OR_MODEL);
  const orParams = map.get(KEY_OR_PARAMS);
  const orProvider = map.get(KEY_OR_PROVIDER);
  const routing = map.get(KEY_ROUTING);
  const launch = map.get(KEY_LAUNCH) as
    | { countdownEnabled?: unknown; targetAt?: unknown }
    | undefined;
  return {
    briefPageEnabled:
      typeof brief === "boolean" ? brief : DEFAULT_SETTINGS.briefPageEnabled,
    provider: normalizeProviderValue(provider),
    openrouterModel: typeof orModel === "string" ? orModel : "",
    openrouterParams: normalizeOpenRouterParams(orParams),
    openrouterProvider: typeof orProvider === "string" ? orProvider : "",
    routing: routing === "full" ? "full" : "smart",
    launch: {
      countdownEnabled: Boolean(launch?.countdownEnabled),
      targetAt: typeof launch?.targetAt === "string" ? launch.targetAt : null,
    },
  };
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const rows = await prisma.appSetting.findMany();
    const s = normalize(new Map(rows.map((r) => [r.key, r.value as unknown])));

    // Авто-выключение по истечении таймера: как только targetAt прошёл, режим
    // «до запуска» сам гаснет (доступ открывается, тарифы/кнопки возвращаются,
    // тумблер в админке — OFF). Возвращаем уже выключенным СРАЗУ (корректность
    // не зависит от записи), а флаг в БД гасим фоном — один раз на переходе.
    if (s.launch.countdownEnabled && s.launch.targetAt) {
      const t = Date.parse(s.launch.targetAt);
      if (!Number.isNaN(t) && t <= Date.now()) {
        const launch = { ...s.launch, countdownEnabled: false };
        void persistLaunch(launch).catch((err) =>
          console.error("[settings] auto-disable launch failed:", err)
        );
        return { ...s, launch };
      }
    }
    return s;
  } catch (err) {
    // Сбой БД не должен ронять лендинг/гейт — деградируем до дефолтов.
    console.error("[settings] read failed:", err);
    return DEFAULT_SETTINGS;
  }
}

// Прямой апсерт строки launch (без saveSettings, чтобы не зациклить getSettings).
async function persistLaunch(launch: AppSettings["launch"]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: KEY_LAUNCH },
    create: { key: KEY_LAUNCH, value: launch as unknown as Prisma.InputJsonValue },
    update: { value: launch as unknown as Prisma.InputJsonValue },
  });
}

// Частичное обновление: мерджим с текущими, апсертим обе строки в транзакции.
export async function saveSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await getSettings();
  const next: AppSettings = {
    briefPageEnabled: input.briefPageEnabled ?? cur.briefPageEnabled,
    provider: input.provider ?? cur.provider,
    openrouterModel: input.openrouterModel ?? cur.openrouterModel,
    openrouterParams: input.openrouterParams
      ? normalizeOpenRouterParams(input.openrouterParams)
      : cur.openrouterParams,
    openrouterProvider: input.openrouterProvider ?? cur.openrouterProvider,
    routing: input.routing ?? cur.routing,
    launch: { ...cur.launch, ...(input.launch ?? {}) },
  };
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: KEY_BRIEF },
      create: { key: KEY_BRIEF, value: next.briefPageEnabled },
      update: { value: next.briefPageEnabled },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_PROVIDER },
      create: { key: KEY_PROVIDER, value: next.provider },
      update: { value: next.provider },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_OR_MODEL },
      create: { key: KEY_OR_MODEL, value: next.openrouterModel },
      update: { value: next.openrouterModel },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_OR_PARAMS },
      create: {
        key: KEY_OR_PARAMS,
        value: next.openrouterParams as unknown as Prisma.InputJsonValue,
      },
      update: { value: next.openrouterParams as unknown as Prisma.InputJsonValue },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_OR_PROVIDER },
      create: { key: KEY_OR_PROVIDER, value: next.openrouterProvider },
      update: { value: next.openrouterProvider },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_ROUTING },
      create: { key: KEY_ROUTING, value: next.routing },
      update: { value: next.routing },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_LAUNCH },
      create: { key: KEY_LAUNCH, value: next.launch as unknown as Prisma.InputJsonValue },
      update: { value: next.launch as unknown as Prisma.InputJsonValue },
    }),
  ]);
  return next;
}

// Режим «до запуска» активен (таймер на лендинге + доступ к ассистенту только
// админам). Мастер-переключатель — `launch.countdownEnabled` (+ задана дата цели).
// По истечении `targetAt` `getSettings()` сам возвращает `countdownEnabled:false`,
// поэтому отдельную проверку «таймер прошёл» здесь дублировать не нужно — лок
// снимается автоматически везде, где читают getSettings.
export function isLaunchLocked(s: AppSettings): boolean {
  return s.launch.countdownEnabled && Boolean(s.launch.targetAt);
}

// Публичный срез для клиента (сейчас совпадает с полным; держим отдельно, чтобы
// при добавлении приватных флагов не утекли наружу).
export type PublicConfig = AppSettings;
export function toPublicConfig(s: AppSettings): PublicConfig {
  return s;
}
