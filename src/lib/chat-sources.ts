// ── Ссылки из ответа: собрать внизу, убрать повторы ─────────────────────────
//
// ⚠️ Повод: когда включён веб-поиск, модель ставит ссылку-сноску после каждого
// второго предложения, причём ОДНУ И ТУ ЖЕ по пять раз. Читать текст становится
// невозможно: глаз спотыкается о «(rbc.ru)» в середине каждой мысли.
//
// Решение — то же, что в нормальной статье: сноски внизу. Из тела убираем только
// то, что БЕЗ СОМНЕНИЙ является сноской (см. isCitationLabel), а осмысленные
// ссылки с человеческим текстом оставляем на месте — они часть предложения.
// Внизу под ответом показываем полный список без повторов.

export interface ChatSource {
  /** Адрес как есть — по нему и переходим. */
  url: string;
  /** Подпись: домен, а при наличии осмысленного текста ссылки — он. */
  label: string;
}

/** http/https-ссылка в markdown: `[текст](url)`. */
const MD_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
/**
 * Голый адрес в тексте.
 *
 * ⚠️ БЕЗ lookbehind: Safari до 16.4 его не понимает и роняет разбор всего модуля
 * — ровно этот баг мы уже ловили на remark-gfm (см. патч в patches/). Отсечь
 * адреса внутри markdown-ссылок можно и без него: сначала вырезаем ссылки.
 */
const BARE_URL = /https?:\/\/[^\s<>)\]"']+/g;

/**
 * Ключ для склейки повторов.
 *
 * ⚠️ Схема, `www.`, завершающий слэш, якорь и utm-хвост отбрасываются: одна и та
 * же страница приезжает от модели в трёх написаниях, и без нормализации список
 * «источников» состоит из дублей одного адреса.
 */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const params = new URLSearchParams(u.search);
    for (const k of Array.from(params.keys())) {
      if (k.toLowerCase().startsWith("utm_")) params.delete(k);
    }
    const qs = params.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Домен без www — им подписываем источник, когда своего текста у ссылки нет. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Текст ссылки — это сноска, а не часть предложения?
 *
 * ⚠️ Список намеренно узкий. Ошибиться тут можно только в одну сторону: убрать
 * из текста ссылку, которая была частью мысли («смотри [разбор этого кейса](…)»),
 * и предложение развалится. Поэтому режем лишь то, что и так ничего не значит.
 */
function isCitationLabel(text: string, url: string): boolean {
  const t = text.trim().replace(/^[[(]|[)\]]$/g, "").trim();
  if (!t) return true; // [](url)
  if (t === url) return true; // текст = сам адрес
  if (/^\d{1,3}$/.test(t)) return true; // [1], [12]
  if (/^(источник|источники|ссылка|подробнее|тут|здесь|source|link|ref)$/i.test(t)) return true;
  // Текст — это домен: «rbc.ru», «www.rbc.ru», «vc.ru/12345».
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return true;
  return false;
}

/** Все ссылки ответа без повторов, в порядке появления. */
export function extractSources(markdown: string): ChatSource[] {
  const seen = new Set<string>();
  const out: ChatSource[] = [];

  const push = (url: string, text: string) => {
    const clean = url.replace(/[.,;:!?)]+$/, "");
    const key = dedupeKey(clean);
    if (seen.has(key)) return;
    seen.add(key);
    const label = isCitationLabel(text, clean) ? hostLabel(clean) : text.trim();
    out.push({ url: clean, label: label.slice(0, 120) });
  };

  let m: RegExpExecArray | null;
  const linkRe = new RegExp(MD_LINK.source, "g");
  while ((m = linkRe.exec(markdown)) !== null) push(m[2], m[1]);

  // Голые адреса добираем по тексту, из которого уже убраны markdown-ссылки:
  // иначе адрес внутри `[текст](url)` посчитается вторым разом.
  const withoutLinks = markdown.replace(linkRe, " ");
  const bareRe = new RegExp(BARE_URL.source, "g");
  while ((m = bareRe.exec(withoutLinks)) !== null) push(m[0], m[0]);

  return out;
}

/**
 * Убрать из тела сноски-повторы.
 *
 * Что уходит: ссылки со «сносочным» текстом, голые адреса в скобках и осиротевшие
 * скобки/запятые, которые от них остались. Что остаётся: ссылки с осмысленным
 * текстом и одиночные адреса в строке (их модель даёт как ответ на «дай ссылку»).
 */
export function stripCitationLinks(markdown: string): string {
  // ⚠️ ОДИН проход по обоим видам ссылок сразу, а не два правила подряд. С двумя
  // правилами второе (голый адрес в скобках) съедало `(url)` у уже разобранной
  // markdown-ссылки, и на экране оставалось осиротевшее «[разбор кейса]» —
  // ловили на тесте. В чередовании markdown-ссылка стоит ПЕРВОЙ, поэтому её
  // хвост никогда не достаётся второму варианту.
  const combined = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|\(\s*(https?:\/\/[^\s)]+)\s*\)/g;

  let out = markdown.replace(combined, (full, text: string, url: string, bare: string) => {
    // Голый адрес в скобках — всегда сноска: «… вырос вдвое (https://rbc.ru/x).»
    if (bare) return "";
    return isCitationLabel(text, url) ? "" : full;
  });

  // Хвосты от вырезанного: пустые скобки, задвоенные пробелы и пробел перед
  // знаком препинания. ⚠️ Переводы строк не трогаем — на них держится markdown.
  out = out
    .replace(/\(\s*[,;·|]*\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+$/gm, "");

  return out;
}
