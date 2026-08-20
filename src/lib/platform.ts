// ── Площадка проекта: YouTube или Instagram ─────────────────────────────────
//
// Чистый модуль (общий клиенту и серверу). Проект привязан к ОДНОЙ площадке:
// от неё зависят разделы меню, состав аналитики и формат превью. Сменить площадку
// у готового проекта нельзя — цифры и обложки прошлой площадки к новой не относятся.

export const PLATFORMS = ["youtube", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

export function normalizePlatform(v: unknown): Platform {
  return isPlatform(v) ? v : "youtube";
}

export interface PlatformMeta {
  key: Platform;
  label: string;
  /** Как называется единица контента — подставляется в тексты интерфейса. */
  unit: string;
  unitPlural: string;
  /** Как называется «канал» на этой площадке. */
  account: string;
  color: string; // Mantine-цвет
  /** Соотношение сторон обложки: у YouTube горизонталь, у Reels — вертикаль. */
  aspect: "16:9" | "9:16";
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  youtube: {
    key: "youtube",
    label: "YouTube",
    unit: "ролик",
    unitPlural: "ролики",
    account: "канал",
    color: "red",
    aspect: "16:9",
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    unit: "рилс",
    unitPlural: "рилсы",
    account: "аккаунт",
    color: "grape",
    aspect: "9:16",
  },
};

export function platformMeta(v: unknown): PlatformMeta {
  return PLATFORM_META[normalizePlatform(v)];
}

// Разделы, которых на площадке нет. ⚠️ Поиск референсов и конкуренты работают
// через YouTube Data API (публичный поиск по чужим каналам); у Instagram такого
// API нет вовсе — Graph API отдаёт только СВОЙ аккаунт, чужие данные закрыты.
// Поэтому у Instagram-проекта этих разделов не показываем, а не показываем
// пустыми: пустой раздел читается как поломка.
const HIDDEN_SEGMENTS: Record<Platform, string[]> = {
  youtube: [],
  instagram: ["competitors", "references"],
};

export function segmentAvailable(platform: Platform, seg: string): boolean {
  return !HIDDEN_SEGMENTS[platform].includes(seg);
}
