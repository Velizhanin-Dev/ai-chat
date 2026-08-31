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
  // Пин шлёт `provider: { order: [slug], allow_fallbacks: true }` — приоритет
  // одному провайдеру (кэш греется), но с фолбэком на других при его сбое/недоступности
  // (иначе 404 "No endpoints found" / 429). "" = авто-балансировка (без пина).
  openrouterProvider: string;
  /**
   * Модель для СТРУКТУРНЫХ задач (JSON на выходе: контент-план, опорные блоки,
   * профиль проекта, разборы, автозаполнение брифа, заготовка превью).
   *
   * ⚠️ Зачем отдельно от чата: чату важны стрим, TTFT и живой русский; структурным
   * задачам — только валидный JSON, стрим там никто не видит. Это разные
   * требования, и лучшая модель для одного не обязана быть лучшей для другого
   * (замер 2026-08-31: luna быстрее V4 Pro в 5-6 раз по TTFT, но для тяжёлого
   * JSON может быть выгоднее модель постарше). Пусто = как у чата.
   */
  openrouterStructuredModel: string;
  /** Пин провайдера для структурной модели (у другой модели другие провайдеры). */
  openrouterStructuredProvider: string;
  // Модель генерации превью (раздел «Генератор превью»). Всегда OpenRouter —
  // независимо от provider выше (чат может работать на Claude/GLM). Дефолт задаёт
  // IMAGE_DEFAULT_MODEL в src/lib/llm/image.ts (Nano Banana Pro), "" = дефолт.
  imageModel: string;
  // Веб-поиск в чате (только OpenRouter — плагин `web` в теле запроса). Даёт модели
  // свежую фактуру и снижает шанс выдуманной отраслевой конкретики.
  // ⚠️ ПЛАТНЫЙ отдельно от токенов: замерено ~$0.004 за результат (3 результата =
  // +$0.012 к запросу, сопоставимо со стоимостью самой генерации). Поэтому по
  // умолчанию ВЫКЛЮЧЕН и включается осознанно.
  // Кэш промпта плагин НЕ ломает — проверено замером: выдача вставляется ПОСЛЕ
  // кэшируемого префикса (cached_tokens с плагином 13135/14520 против 11406/12412
  // без него). Так что full-режим на DeepSeek от него не страдает.
  webSearch: {
    enabled: boolean;
    // Сколько результатов запрашивать (1–5). Каждый — деньги, дефолт 3.
    maxResults: number;
  };
  // Пробный период: сколько часов он живёт. Число ЗАПРОСОВ в нём — отдельная
  // ручка: Plan.limits.requests тарифа start (редактор тарифов). Здесь только срок.
  trialHours: number;
  // Метка массового сброса пробных периодов (ISO) или null. Сама по себе ничего не
  // меняет: при заходе юзера maybeGrantTrial сравнивает её с User.trialGrantedAt и,
  // если метка новее, выдаёт пробный период ЗАНОВО — от момента визита.
  // ⚠️ Именно так, а не разовым updateMany: иначе срок отсчитывался бы от нажатия
  // кнопки, и пришедший через четыре часа человек попал бы на закрытую дверь.
  trialResetAt: string | null;
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
  openrouterStructuredModel: "",
  openrouterStructuredProvider: "",
  imageModel: "",
  trialHours: 1,
  trialResetAt: null,
  webSearch: { enabled: false, maxResults: 3 },
  launch: { countdownEnabled: false, targetAt: null },
};

// Ключи строк в таблице AppSetting.
const KEY_BRIEF = "brief_page_enabled";
const KEY_LAUNCH = "launch";
const KEY_PROVIDER = "provider";
const KEY_OR_MODEL = "openrouter_model";
const KEY_OR_PARAMS = "openrouter_params";
const KEY_OR_PROVIDER = "openrouter_provider";
const KEY_OR_STRUCT_MODEL = "openrouter_structured_model";
const KEY_OR_STRUCT_PROVIDER = "openrouter_structured_provider";
const KEY_ROUTING = "routing";
const KEY_IMAGE_MODEL = "image_model";
const KEY_WEB_SEARCH = "web_search";
const KEY_TRIAL_HOURS = "trial_hours";
const KEY_TRIAL_RESET = "trial_reset_at";

// Кламп срока пробного периода: 1–168 часов (неделя). Ноль превратил бы пробный
// период в «истёк сразу», а безлимит — в бесплатный тариф.
export function normalizeTrialHours(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(168, Math.max(1, Math.round(n))) : 1;
}

// Кламп числа результатов поиска: 1–5. Каждый результат платный (~$0.004),
// поэтому потолок низкий и осознанный.
export function normalizeWebSearch(v: unknown): AppSettings["webSearch"] {
  const raw = (v ?? {}) as { enabled?: unknown; maxResults?: unknown };
  const n = Number(raw.maxResults);
  return {
    enabled: Boolean(raw.enabled),
    maxResults: Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3,
  };
}

function normalizeProviderValue(_v: unknown): LlmProvider {
  // ⚠️ Движок ЗАФИКСИРОВАН на OpenRouter (решение владельца, 2026-08-31): Claude
  // и GLM напрямую больше не используются — нужные модели берём через каталог
  // OpenRouter. Стратегии claude/glm остаются в коде как запасной путь, но
  // выбор из админки убран, и что бы ни лежало в БД — работаем через OpenRouter.
  return "openrouter";
}

// Нормализация «сырых» JSON-значений из БД к типу AppSettings (с дефолтами).
function normalize(map: Map<string, unknown>): AppSettings {
  const brief = map.get(KEY_BRIEF);
  const provider = map.get(KEY_PROVIDER);
  const orModel = map.get(KEY_OR_MODEL);
  const orParams = map.get(KEY_OR_PARAMS);
  const orProvider = map.get(KEY_OR_PROVIDER);
  const routing = map.get(KEY_ROUTING);
  const imageModel = map.get(KEY_IMAGE_MODEL);
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
    openrouterStructuredModel:
      typeof map.get(KEY_OR_STRUCT_MODEL) === "string"
        ? (map.get(KEY_OR_STRUCT_MODEL) as string)
        : "",
    openrouterStructuredProvider:
      typeof map.get(KEY_OR_STRUCT_PROVIDER) === "string"
        ? (map.get(KEY_OR_STRUCT_PROVIDER) as string)
        : "",
    imageModel: typeof imageModel === "string" ? imageModel : "",
    webSearch: normalizeWebSearch(map.get(KEY_WEB_SEARCH)),
    trialHours: normalizeTrialHours(map.get(KEY_TRIAL_HOURS)),
    trialResetAt:
      typeof map.get(KEY_TRIAL_RESET) === "string" ? (map.get(KEY_TRIAL_RESET) as string) : null,
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
    openrouterStructuredModel:
      input.openrouterStructuredModel ?? cur.openrouterStructuredModel,
    openrouterStructuredProvider:
      input.openrouterStructuredProvider ?? cur.openrouterStructuredProvider,
    imageModel: input.imageModel ?? cur.imageModel,
    routing: input.routing ?? cur.routing,
    webSearch: input.webSearch
      ? normalizeWebSearch({ ...cur.webSearch, ...input.webSearch })
      : cur.webSearch,
    trialHours:
      input.trialHours == null ? cur.trialHours : normalizeTrialHours(input.trialHours),
    trialResetAt: input.trialResetAt === undefined ? cur.trialResetAt : input.trialResetAt,
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
      where: { key: KEY_OR_STRUCT_MODEL },
      create: { key: KEY_OR_STRUCT_MODEL, value: next.openrouterStructuredModel },
      update: { value: next.openrouterStructuredModel },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_OR_STRUCT_PROVIDER },
      create: { key: KEY_OR_STRUCT_PROVIDER, value: next.openrouterStructuredProvider },
      update: { value: next.openrouterStructuredProvider },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_TRIAL_HOURS },
      create: { key: KEY_TRIAL_HOURS, value: next.trialHours },
      update: { value: next.trialHours },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_TRIAL_RESET },
      // JSON-колонка: null пишем через Prisma.JsonNull, иначе типы не сходятся.
      create: { key: KEY_TRIAL_RESET, value: next.trialResetAt ?? Prisma.JsonNull },
      update: { value: next.trialResetAt ?? Prisma.JsonNull },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_WEB_SEARCH },
      create: {
        key: KEY_WEB_SEARCH,
        value: next.webSearch as unknown as Prisma.InputJsonValue,
      },
      update: { value: next.webSearch as unknown as Prisma.InputJsonValue },
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
      where: { key: KEY_IMAGE_MODEL },
      create: { key: KEY_IMAGE_MODEL, value: next.imageModel },
      update: { value: next.imageModel },
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

// ── Выбор модели под тип задачи ─────────────────────────────────────────────
//
// Структурные задачи (JSON): контент-план, опорные блоки, профиль, разборы,
// автозаполнение, заготовка превью. Пустая структурная модель = модель чата —
// поведение до разделения, ничего не ломается.
//
// ⚠️ Пин провайдера идёт ПАРОЙ с моделью: у другой модели другой список
// провайдеров, и чатовый пин к структурной модели неприменим (получили бы
// вечный фолбэк мимо кэша).
export function structuredModelOf(s: AppSettings): { model: string; orProvider: string } {
  if (s.openrouterStructuredModel) {
    return { model: s.openrouterStructuredModel, orProvider: s.openrouterStructuredProvider };
  }
  return { model: s.openrouterModel, orProvider: s.openrouterProvider };
}
