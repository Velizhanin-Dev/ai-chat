import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

// ── Глобальные настройки / фичефлаги ────────────────────────────────────────
// Источник правды — таблица AppSetting (key→JSON), правится из админки. Здесь —
// типизированный доступ с дефолтами: читаем серверно (лендинг, гейт брифа),
// отдаём клиенту только безопасный публичный срез (getPublicConfig). Серверный
// модуль (Prisma) — НЕ импортировать в клиентские компоненты.

export interface AppSettings {
  // Доступна ли анонимная страница брифа по QR (/brief). Выкл → 404.
  briefPageEnabled: boolean;
  // Режим «скоро запуск»: таймер в герое + скрытые тарифы на лендинге.
  launch: {
    countdownEnabled: boolean;
    // ISO-дата цели отсчёта (или null, если не задана).
    targetAt: string | null;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  briefPageEnabled: true,
  launch: { countdownEnabled: false, targetAt: null },
};

// Ключи строк в таблице AppSetting.
const KEY_BRIEF = "brief_page_enabled";
const KEY_LAUNCH = "launch";

// Нормализация «сырых» JSON-значений из БД к типу AppSettings (с дефолтами).
function normalize(map: Map<string, unknown>): AppSettings {
  const brief = map.get(KEY_BRIEF);
  const launch = map.get(KEY_LAUNCH) as
    | { countdownEnabled?: unknown; targetAt?: unknown }
    | undefined;
  return {
    briefPageEnabled:
      typeof brief === "boolean" ? brief : DEFAULT_SETTINGS.briefPageEnabled,
    launch: {
      countdownEnabled: Boolean(launch?.countdownEnabled),
      targetAt: typeof launch?.targetAt === "string" ? launch.targetAt : null,
    },
  };
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const rows = await prisma.appSetting.findMany();
    return normalize(new Map(rows.map((r) => [r.key, r.value as unknown])));
  } catch (err) {
    // Сбой БД не должен ронять лендинг/гейт — деградируем до дефолтов.
    console.error("[settings] read failed:", err);
    return DEFAULT_SETTINGS;
  }
}

// Частичное обновление: мерджим с текущими, апсертим обе строки в транзакции.
export async function saveSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await getSettings();
  const next: AppSettings = {
    briefPageEnabled: input.briefPageEnabled ?? cur.briefPageEnabled,
    launch: { ...cur.launch, ...(input.launch ?? {}) },
  };
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: KEY_BRIEF },
      create: { key: KEY_BRIEF, value: next.briefPageEnabled },
      update: { value: next.briefPageEnabled },
    }),
    prisma.appSetting.upsert({
      where: { key: KEY_LAUNCH },
      create: { key: KEY_LAUNCH, value: next.launch as unknown as Prisma.InputJsonValue },
      update: { value: next.launch as unknown as Prisma.InputJsonValue },
    }),
  ]);
  return next;
}

// Публичный срез для клиента (сейчас совпадает с полным; держим отдельно, чтобы
// при добавлении приватных флагов не утекли наружу).
export type PublicConfig = AppSettings;
export function toPublicConfig(s: AppSettings): PublicConfig {
  return s;
}
