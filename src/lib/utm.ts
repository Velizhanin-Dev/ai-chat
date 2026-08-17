// ── UTM-метки: единый формат для клиента и сервера ──────────────────────────
// Ссылки вида https://ai.velizhanin.com/?utm_source=tg&utm_medium=article&utm_campaign=ad
// Яндекс.Метрика разбирает такие метки сама, но связать с ними ПОКУПКУ она может
// только внутри одного визита. У нас человек обычно приходит по метке, регистрируется,
// а платит позже и уже «напрямую» — для Метрики это direct. Поэтому метки храним у
// себя: первое касание пишем пользователю (User), метку на момент оплаты — платежу
// (Payment). Захват на клиенте — src/lib/utm-client.ts.

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
}

// Первое касание: метки + откуда пришёл и на какую страницу — по ним видно
// органику/прямые заходы, у которых utm нет вовсе.
export interface UtmTouch extends Utm {
  referrer: string;
  landing: string;
}

export const UTM_FIELDS = ["source", "medium", "campaign", "content", "term"] as const;
export type UtmField = (typeof UTM_FIELDS)[number];

export const EMPTY_UTM: Utm = {
  source: "",
  medium: "",
  campaign: "",
  content: "",
  term: "",
};

export const EMPTY_TOUCH: UtmTouch = { ...EMPTY_UTM, referrer: "", landing: "" };

// Метки приходят из URL, то есть от кого угодно — режем длину, чтобы никто не
// раздул колонку и отчёт мусором.
const MAX_LEN = 150;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_LEN) : "";
}

// Разбор из query-строки (?utm_source=…). Принимает строку или готовые params.
export function parseUtm(search: string | URLSearchParams): UtmTouch {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    source: clean(p.get("utm_source")),
    medium: clean(p.get("utm_medium")),
    campaign: clean(p.get("utm_campaign")),
    content: clean(p.get("utm_content")),
    term: clean(p.get("utm_term")),
    referrer: "",
    landing: "",
  };
}

// Нормализация произвольного объекта (тело запроса, cookie, localStorage).
export function sanitizeUtm(input: unknown): Utm {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    source: clean(o.source),
    medium: clean(o.medium),
    campaign: clean(o.campaign),
    content: clean(o.content),
    term: clean(o.term),
  };
}

export function sanitizeTouch(input: unknown): UtmTouch {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    ...sanitizeUtm(o),
    referrer: clean(o.referrer),
    landing: clean(o.landing),
  };
}

// Есть ли хоть одна метка (пустой объект в БД не пишем — там останется null).
export function hasUtm(u: Partial<Utm> | null | undefined): boolean {
  if (!u) return false;
  return UTM_FIELDS.some((f) => Boolean(u[f]));
}

// Поля для prisma-записи: пустая строка → null, чтобы «нет метки» было одним
// значением, а не двумя ("" и null) — иначе группировка в отчёте раздваивается.
export function utmToRow(u: Utm): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
} {
  const n = (v: string) => (v ? v : null);
  return {
    utmSource: n(u.source),
    utmMedium: n(u.medium),
    utmCampaign: n(u.campaign),
    utmContent: n(u.content),
    utmTerm: n(u.term),
  };
}

// Обратное: строка БД (User/Payment) → Utm. Прямо на prisma-строке, чтобы не
// таскать по коду семь nullable-полей.
export function rowToUtm(row: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}): Utm {
  return {
    source: row.utmSource ?? "",
    medium: row.utmMedium ?? "",
    campaign: row.utmCampaign ?? "",
    content: row.utmContent ?? "",
    term: row.utmTerm ?? "",
  };
}

// Подпись источника для админки: «tg / article / ad».
export function utmLabel(u: Partial<Utm> | null | undefined): string {
  if (!hasUtm(u)) return "—";
  const parts = [u!.source || "?", u!.medium || "?", u!.campaign || "?"];
  // Хвостовые «?» не показываем: «tg / article» читается лучше, чем «tg / article / ?».
  while (parts.length > 1 && parts[parts.length - 1] === "?") parts.pop();
  return parts.join(" / ");
}

// Параметры для цели Яндекс.Метрики (плоский объект с привычными именами).
export function utmGoalParams(u: Partial<Utm> | null | undefined): Record<string, string> {
  if (!hasUtm(u)) return {};
  const out: Record<string, string> = {};
  for (const f of UTM_FIELDS) {
    const v = u![f];
    if (v) out[`utm_${f}`] = v;
  }
  return out;
}
