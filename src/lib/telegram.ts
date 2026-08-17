// ── Уведомления в Telegram ─────────────────────────────────────────────────
// Каждое сообщение из чата техподдержки дублируем в телеграм-бот, чтобы вопрос
// не лежал непрочитанным в админке. Отвечаем НЕ из телеграма, а в /admin/support
// (бот односторонний — уведомление + ссылка на переписку).
//
// Без TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ничего не шлём: пишем в лог сервера
// и молча выходим (как с письмами Unisender) — приложение работает как обычно.

const API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";

// Боевой адрес приложения — база для ссылок в уведомлениях. Телеграм открывает
// их на ТЕЛЕФОНЕ, поэтому localhost из NEXT_PUBLIC_APP_URL тут бесполезен (и
// inline-кнопку с ним Bot API вообще отвергает). Берём переменную, только если
// она публичная; иначе — прод-домен. Так кнопка живая и при разработке.
const PROD_APP_URL = "https://ai.velizhanin.com";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// ⚠️⚠️ Эмодзи собираем из кодов, а НЕ пишем символом в исходнике. Причина — баг
// минификатора SWC (Next 14): символ вне BMP (а все эмодзи такие) внутри ШАБЛОННОЙ
// строки эмитится с УДВОЕННЫМ слэшем — `\\uD83D\\uDCB0` вместо `💰`, и
// в телеграм улетает текст «💰» вместо 💰. Ловили вживую на уведомлении
// об оплате: там оптимизатор свернул массив строк в один шаблон, и эмодзи сломался,
// а в соседнем уведомлении о поддержке массив остался массивом — и там всё было
// цело. То есть баг зависит от того, как оптимизатор свернёт код, и «переписать
// покрасивее» его в любой момент вернёт. String.fromCodePoint не проходит через
// экранирование вовсе, поэтому от вёрстки кода не зависит.
const EMOJI = {
  money: String.fromCodePoint(0x1f4b0), // 💰
  card: String.fromCodePoint(0x1f4b3), // 💳
  sos: String.fromCodePoint(0x1f198), // 🆘
  speech: String.fromCodePoint(0x1f4ac), // 💬
  warning: String.fromCodePoint(0x26a0), // ⚠ (BMP, но держим тут же — чтобы список был один)
};

export function telegramConfigured(): boolean {
  return Boolean(token && chatId);
}

// Экранирование под parse_mode=HTML (только эти три символа значимы).
// Экспортируем: ответ поддержки в личку собирается в роуте админки.
export function escapeHtml(v: string): string {
  return esc(v);
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Телеграм режет сообщения длиннее 4096 символов — обрезаем сами, с многоточием.
const MAX_LEN = 3500;
function clamp(v: string): string {
  return v.length > MAX_LEN ? `${v.slice(0, MAX_LEN)}…` : v;
}

// Публичный ли URL: Bot API принимает в inline-кнопке только такие (на localhost
// отвечает BUTTON_URL_INVALID и НЕ доставляет сообщение целиком).
function publicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname;
    return h !== "localhost" && h !== "127.0.0.1" && h !== "0.0.0.0" && h !== "::1";
  } catch {
    return false;
  }
}

// База ссылок: своя переменная, если она публичная, иначе прод-домен.
const APP_URL = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return publicUrl(raw) ? raw : PROD_APP_URL;
})();

// Низкоуровневая отправка. Best-effort: сеть/ошибку API логируем и не роняем
// вызывающий код — сообщение поддержки уже сохранено в БД, уведомление вторично.
// action — кнопка под сообщением (inline_keyboard); ссылки строим от APP_URL,
// который всегда публичный, но URL всё равно проверяем: с непубличным Bot API
// отвергает ВСЁ сообщение (BUTTON_URL_INVALID), а уведомление важнее кнопки.
async function send(
  html: string,
  action?: { text: string; url: string },
  // Кому шлём. По умолчанию — админский чат (TELEGRAM_CHAT_ID); для ответа
  // пользователю в его личку передаём его chat_id (см. sendToChat).
  toChatId?: string
): Promise<void> {
  const target = toChatId ?? chatId;
  if (!token || !target) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы — уведомление не отправлено");
    return;
  }
  const withButton = action && publicUrl(action.url);
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(withButton
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: action!.text, url: action!.url }]],
              },
            }
          : {}),
      }),
      // Не подвешиваем запрос пользователя из-за медленного телеграма.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram] sendMessage ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[telegram] ошибка отправки:", err);
  }
}

// Ответ поддержки пользователю в личку бота. Тем же ботом, что шлёт уведомления
// админу, — отдельный токен не нужен. Best-effort: человек в любом случае увидит
// ответ в разделе поддержки на сайте.
export async function sendToChat(chatIdTo: string, html: string): Promise<void> {
  await send(html, undefined, chatIdTo);
}

// Уведомление о новом вопросе в поддержку: от кого + текст + кнопка на ответ.
export async function notifySupportMessage(params: {
  userId: string;
  name: string;
  email: string;
  content: string;
}): Promise<void> {
  const link = `${APP_URL}/admin/support?user=${encodeURIComponent(params.userId)}`;
  const html = [
    `${EMOJI.sos} <b>Вопрос в поддержку</b>`,
    "",
    `<b>От:</b> ${esc(params.name)} (${esc(params.email)})`,
    "",
    esc(clamp(params.content)),
  ].join("\n");
  await send(html, { text: `${EMOJI.speech} Ответить в админке`, url: link });
}

// Письмо не ушло — зовём администратора. Нужно именно уведомление, а не запись в
// лог: сброс пароля был сломан незаметно (Unisender отвечал «Api mode is off»,
// письмо не уходило, человек видел «Проверьте почту»), и узнать об этом можно было
// только случайно. Причина всегда на нашей стороне — ключ, доступ по API,
// неподтверждённый адрес отправителя.
//
// ⚠️ Адрес получателя НЕ пишем: уведомление уходит в общий чат, а знать, кто
// восстанавливает пароль, админу для починки не требуется.
export async function notifyMailFailure(params: {
  kind: string;
  reason: string;
}): Promise<void> {
  const html = [
    `${EMOJI.warning} <b>Письмо не отправлено</b>`,
    "",
    `<b>Что:</b> ${esc(params.kind)}`,
    `<b>Причина:</b> ${esc(params.reason)}`,
    "",
    "Человек остался без письма и об этом не знает. Проверь ключ Unisender и что в кабинете включён доступ по API.",
  ].join("\n");
  await send(html);
}

// Уведомление об успешной оплате тарифа. Шлётся из markPaid (billing.ts) — там
// же, где платёж применяется, и ровно один раз: markPaid идемпотентен, поэтому
// повторный вебхук/синк уведомление не продублирует.
export async function notifyPaymentSuccess(params: {
  userId: string;
  name: string;
  email: string;
  planLabel: string;
  // Сумма платежа в КОПЕЙКАХ (как хранится в Payment.amount).
  amountKopecks: number;
  // "tbank" (российская карта) | "cloudpayments" (зарубежная).
  provider: string;
  // До какого числа продлён доступ.
  expiresAt: Date;
  // UTM-метка на момент оплаты и метка, с которой человек когда-то пришёл
  // («tg / article / ad»). Обе — уже готовые подписи из utmLabel (billing.ts).
  // Строки разные не случайно: пришёл человек обычно по одной ссылке, а платит
  // после другой — по первой понятно, какой канал приводит, по второй — что
  // дожимает. Совпадающие подписи схлопываем в одну строку.
  sourcePayment?: string;
  sourceSignup?: string;
}): Promise<void> {
  const rub = (params.amountKopecks / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const providerLabel =
    params.provider === "cloudpayments" ? "CloudPayments" : "ТБанк";
  const until = params.expiresAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const link = `${APP_URL}/admin/payments`;

  const paid = params.sourcePayment && params.sourcePayment !== "—" ? params.sourcePayment : "";
  const signup = params.sourceSignup && params.sourceSignup !== "—" ? params.sourceSignup : "";
  const sourceLines: string[] = [];
  if (paid && signup && paid !== signup) {
    sourceLines.push(`<b>Откуда покупка:</b> ${esc(paid)}`);
    sourceLines.push(`<b>Откуда пришёл:</b> ${esc(signup)}`);
  } else if (paid || signup) {
    sourceLines.push(`<b>Источник:</b> ${esc(paid || signup)}`);
  } else {
    // Молчать нельзя: пустая строка читается как «забыли», а «без меток» —
    // это конкретный ответ (прямой заход, закладка, органика).
    sourceLines.push("<b>Источник:</b> без меток");
  }

  const html = [
    `${EMOJI.money} <b>Оплата тарифа</b>`,
    "",
    `<b>Кто:</b> ${esc(params.name)} (${esc(params.email)})`,
    `<b>Тариф:</b> ${esc(params.planLabel)}`,
    `<b>Сумма:</b> ${esc(rub)} ₽ · ${esc(providerLabel)}`,
    ...sourceLines,
    `<b>Доступ до:</b> ${esc(until)}`,
  ].join("\n");
  await send(html, { text: `${EMOJI.card} Платежи в админке`, url: link });
}
