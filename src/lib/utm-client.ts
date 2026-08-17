import {
  parseUtm,
  sanitizeTouch,
  hasUtm,
  EMPTY_TOUCH,
  type Utm,
  type UtmTouch,
} from "./utm";

// ── Захват UTM в браузере ───────────────────────────────────────────────────
// Держим ДВА касания:
//  • first — как человек попал к нам ВПЕРВЫЕ (пишется один раз и больше не
//    перетирается). Уходит в User при регистрации: «откуда он вообще пришёл».
//  • last — метки последнего захода по ссылке с utm. Уходит в Payment: «по какой
//    ссылке он пришёл в тот раз, когда купил».
// Первое касание пишем ДАЖЕ без меток (referrer + посадочная) — иначе про
// органику и прямые заходы в отчёте не будет вообще ничего.
// Всё best-effort: приватный режим и переполненная квота localStorage не должны
// ронять страницу.

const FIRST_KEY = "creative-chat:utm-first-v1";
const LAST_KEY = "creative-chat:utm-last-v1";

// Первое касание дублируем в cookie: вход через VK/Яндекс уходит на редиректы и
// возвращается СЕРВЕРНЫМ колбэком, где localStorage недоступен — оттуда метку
// можно прочитать только из cookie (см. src/lib/utm-server.ts).
export const UTM_COOKIE = "cc_utm";

// Живут дольше сессии, но не вечно: метка полугодовой давности к сегодняшней
// покупке отношения уже не имеет.
const TTL_MS = 180 * 86400000; // 180 дней

interface StoredTouch extends UtmTouch {
  at: number; // когда записали (мс)
}

function read(key: string): StoredTouch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTouch>;
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!at || Date.now() - at > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return { ...sanitizeTouch(parsed), at };
  } catch {
    return null;
  }
}

function write(key: string, touch: UtmTouch): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...touch, at: Date.now() }));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

// Дубль первого касания в cookie — только ради OAuth-колбэка (см. UTM_COOKIE).
// Не httpOnly: ставится из браузера. Значение кодируем — в нём произвольный текст
// из адресной строки, а сырые «;» и «,» порвали бы cookie.
function writeCookie(touch: UtmTouch): void {
  try {
    const value = encodeURIComponent(JSON.stringify(touch));
    // 4 КБ — предел cookie; при аномально длинных метках просто не пишем.
    if (value.length > 3000) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${UTM_COOKIE}=${value}; path=/; max-age=${Math.floor(
      TTL_MS / 1000
    )}; SameSite=Lax${secure}`;
  } catch {
    /* not critical */
  }
}

// Вызывается на каждой загрузке/переходе (см. components/Analytics/UtmCapture).
export function captureUtm(): void {
  if (typeof window === "undefined") return;

  const utm = parseUtm(window.location.search);
  const touch: UtmTouch = {
    ...utm,
    // document.referrer пуст при прямом заходе и при переходах внутри сайта.
    referrer: document.referrer || "",
    landing: window.location.pathname || "/",
  };

  if (hasUtm(utm)) write(LAST_KEY, touch);

  // Первое касание — только если его ещё нет. Внутренние переходы (реферер с
  // нашего же домена, меток нет) первым касанием не считаем: иначе у человека,
  // пришедшего по метке на лендинг, «источником» стала бы наша же страница.
  const existing = read(FIRST_KEY);
  if (existing) return;
  const internal = touch.referrer.startsWith(window.location.origin);
  if (hasUtm(utm) || !internal) {
    write(FIRST_KEY, touch);
    writeCookie(touch);
  }
}

// Первое касание — уходит в User при регистрации.
export function readFirstTouch(): UtmTouch {
  return read(FIRST_KEY) ?? EMPTY_TOUCH;
}

// Атрибуция для платежа: метка последнего захода по ссылке, а если её нет —
// первое касание. Иначе покупка человека, который однажды пришёл из телеграма и
// теперь заходит по закладке, осталась бы вообще без источника.
export function readPaymentAttribution(): Utm {
  const last = read(LAST_KEY);
  if (last && hasUtm(last)) return last;
  const first = read(FIRST_KEY);
  return first ?? EMPTY_TOUCH;
}
