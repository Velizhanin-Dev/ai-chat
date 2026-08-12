// ── Пул API-ключей YouTube Data API с ротацией по суточной квоте ─────────────
//
// Зачем отдельно от OAuth. Аналитика канала ходит в API под токеном ПОЛЬЗОВАТЕЛЯ,
// но квота при этом списывается с НАШЕГО Google-проекта — 10 000 units в сутки на
// всех. Поиск конкурентов стоит 100 units за запрос (в 100 раз дороже остальных
// вызовов), поэтому ходить им в тот же проект нельзя: выжжем квоту и уроним раздел
// «Аналитика» у всех сразу.
//
// Поэтому публичный поиск (search.list / videos.list / channels.list по ЧУЖИМ
// данным — авторизация там не нужна, только ключ) идёт по своему пулу ключей:
// `YOUTUBE_API_KEYS` = список через запятую. Работаем с первым ключом, пока он не
// упрётся в суточный лимит, затем переключаемся на следующий. Счётчик сбрасывается
// в полночь по тихоокеанскому времени — именно тогда Google обнуляет квоту.
//
// ⚠️ Ключи должны быть из РАЗНЫХ Google Cloud проектов. Квота считается на проект,
// а не на ключ: пять ключей одного проекта дадут те же 10 000 units, а не 50 000.
//
// ⚠️ Счётчик живёт в памяти процесса и обнуляется при рестарте — поэтому истина не
// в нём, а в ответе Google: 403 с reason=quotaExceeded/dailyLimitExceeded помечает
// ключ исчерпанным до конца суток и переводит запрос на следующий. Счётчик лишь
// экономит заведомо пустые попытки.

const QUOTA_TZ = "America/Los_Angeles";
const FETCH_TIMEOUT_MS = 10_000;

/** Суточный бюджет одного ключа. Реальный лимит Google — 10 000 units на проект. */
function keyDailyUnits(): number {
  const raw = Number(process.env.YOUTUBE_API_KEY_DAILY_UNITS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

/** Текущие «квотные сутки» (полночь PT). Ключ сброса счётчиков. */
export function quotaDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: QUOTA_TZ });
}

export function youtubeKeys(): string[] {
  const raw = process.env.YOUTUBE_API_KEYS ?? process.env.YOUTUBE_API_KEY ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function hasYoutubeKeys(): boolean {
  return youtubeKeys().length > 0;
}

interface KeyState {
  units: number;
  /** Ключ выбыл до конца суток: исчерпана квота или ключ невалидный. */
  dead: null | "quota" | "invalid";
}

const state = new Map<number, KeyState>();
let stateDay = "";

function ensureDay(): void {
  const day = quotaDay();
  if (day !== stateDay) {
    stateDay = day;
    state.clear();
  }
}

function stateOf(i: number): KeyState {
  ensureDay();
  let s = state.get(i);
  if (!s) {
    s = { units: 0, dead: null };
    state.set(i, s);
  }
  return s;
}

/** Сводка по пулу — для админского экрана и понятных ошибок. */
export interface KeyPoolStatus {
  day: string;
  perKeyUnits: number;
  keys: { index: number; units: number; dead: KeyState["dead"] }[];
  /** Сколько units ещё можно потратить сегодня по всему пулу. */
  remaining: number;
}

export function keyPoolStatus(): KeyPoolStatus {
  ensureDay();
  const budget = keyDailyUnits();
  const keys = youtubeKeys().map((_, index) => {
    const s = stateOf(index);
    return { index, units: s.units, dead: s.dead };
  });
  const remaining = keys.reduce(
    (acc, k) => acc + (k.dead ? 0 : Math.max(budget - k.units, 0)),
    0
  );
  return { day: quotaDay(), perKeyUnits: budget, keys, remaining };
}

/** Индекс первого ключа, которому хватит `cost` units. null — пул исчерпан. */
function pickKey(cost: number): number | null {
  const keys = youtubeKeys();
  const budget = keyDailyUnits();
  for (let i = 0; i < keys.length; i += 1) {
    const s = stateOf(i);
    if (s.dead) continue;
    if (s.units + cost > budget) continue;
    return i;
  }
  return null;
}

export class QuotaExhaustedError extends Error {
  readonly code = "YT_QUOTA";
  constructor(message = "Суточная квота YouTube API исчерпана по всем ключам") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export class NoKeysError extends Error {
  readonly code = "YT_NO_KEYS";
  constructor(message = "Ключи YouTube API не настроены (YOUTUBE_API_KEYS)") {
    super(message);
    this.name = "NoKeysError";
  }
}

async function rawGet(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET к публичному YouTube Data API по ключу из пула.
 *
 * `cost` — цена вызова в units (search.list = 100, остальное = 1): её списываем с
 * ключа. При 403/quota помечаем ключ выбывшим и повторяем запрос следующим —
 * пользователь ротацию не замечает.
 */
export async function ytPublicGet<T>(url: string, cost: number): Promise<T> {
  if (!hasYoutubeKeys()) throw new NoKeysError();

  // Попыток не больше, чем ключей: каждая неудача выводит ключ из игры.
  for (let attempt = 0; attempt < youtubeKeys().length; attempt += 1) {
    const index = pickKey(cost);
    if (index === null) break;

    const key = youtubeKeys()[index];
    const sep = url.includes("?") ? "&" : "?";
    const res = await rawGet(`${url}${sep}key=${encodeURIComponent(key)}`);

    if (res.ok) {
      stateOf(index).units += cost;
      return JSON.parse(res.body) as T;
    }

    const body = res.body.slice(0, 500);
    // Квота ключа кончилась (или ключ битый) — выводим до конца суток и берём
    // следующий. rateLimitExceeded — временный всплеск, ключ не хороним.
    if (res.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(body)) {
      stateOf(index).dead = "quota";
      stateOf(index).units = keyDailyUnits();
      console.warn(`[yt-keys] ключ #${index + 1} исчерпал суточную квоту, переключаюсь`);
      continue;
    }
    if (res.status === 400 && /keyInvalid|API key not valid/i.test(body)) {
      stateOf(index).dead = "invalid";
      console.error(`[yt-keys] ключ #${index + 1} невалиден — исключён из пула на сегодня`);
      continue;
    }

    // Прочие ошибки (404/500/сеть) к ключу отношения не имеют — пробрасываем.
    const err = new Error(`youtube_api_${res.status} ${body}`) as Error & { status?: number };
    err.status = res.status;
    // Неуспешный вызов Google всё равно мог списать units — считаем честно.
    stateOf(index).units += cost;
    throw err;
  }

  throw new QuotaExhaustedError();
}
