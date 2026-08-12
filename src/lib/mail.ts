// ── Транзакционные письма (Unisender) ─────────────────────────────────────
// Метод sendEmail: https://www.unisender.com/ru/support/api/messages/sendemail/
// Без UNISENDER_API_KEY / UNISENDER_LIST_ID письмо не уходит — ссылка просто
// пишется в консоль сервера (dev-режим, удобно тестировать без почты).

const API_URL = "https://api.unisender.com/ru/api/sendEmail";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const FROM = process.env.EMAIL_FROM || "Велижанин AI <noreply@velizhanin.com>";

const apiKey = process.env.UNISENDER_API_KEY;
// list_id — обязательный параметр sendEmail: список, от которого предлагается
// отписка (получатель автоматически добавляется в него).
const listId = process.env.UNISENDER_LIST_ID;

const BRAND = "#EC582E";

// Разбираем EMAIL_FROM вида "Имя <mail@dom>" на sender_name + sender_email.
// sender_email обязан быть подтверждён в кабинете Unisender.
function parseFrom(value: string): { name: string; email: string } {
  const m = value.match(/^\s*(.*?)\s*<\s*(.+?)\s*>\s*$/);
  if (m) return { name: m[1] || m[2], email: m[2] };
  return { name: value, email: value };
}

// Чем закончилась отправка. Раньше send() возвращал void и молча глотал ошибку
// провайдера — из-за этого сброс пароля был сломан незаметно: Unisender отвечал
// «Api mode is off» (в кабинете выключен доступ по API), письмо не уходило, а
// человек видел бодрое «Проверьте почту». Теперь исход возвращаем наверх.
export type MailResult = "sent" | "not_configured" | "failed";

export function mailConfigured(): boolean {
  return Boolean(apiKey && listId);
}

async function send(
  to: string,
  subject: string,
  html: string,
  devLink?: string
): Promise<MailResult> {
  // В dev всегда логируем ссылку — чтобы пройти флоу без реальной почты.
  if (devLink && process.env.NODE_ENV !== "production") {
    console.log(`[mail] ${subject} → ${to}\n  ${devLink}`);
  }
  if (!apiKey || !listId) {
    console.warn(
      `[mail] UNISENDER_API_KEY/UNISENDER_LIST_ID не заданы — письмо "${subject}" не отправлено (${to})`
    );
    return "not_configured";
  }

  const { name, email } = parseFrom(FROM);
  const params = new URLSearchParams({
    format: "json",
    api_key: apiKey,
    email: to,
    sender_name: name,
    sender_email: email,
    subject,
    body: html,
    list_id: listId,
    lang: "ru",
    error_checking: "1", // ошибки приходят синхронно, а не в фоне
  });

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      result?: { errors?: { code?: string; message?: string }[] } | unknown;
    };
    // Ошибка уровня API (неверный ключ, выключен доступ по API, нет прав и т.п.).
    if (data.error) {
      console.error(`[mail] Unisender API error: ${data.error} (${data.code ?? "?"})`);
      return "failed";
    }
    // Ошибка по конкретному адресу (при error_checking=1 result — массив).
    const result = data.result as { errors?: { message?: string }[] }[] | undefined;
    const msgErrors = Array.isArray(result) ? result[0]?.errors : undefined;
    if (msgErrors && msgErrors.length) {
      console.error("[mail] Unisender send error", msgErrors);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[mail] исключение при отправке", err);
    return "failed";
  }
}

// Брендовый шаблон письма с одной кнопкой-ссылкой. Внизу — ссылка отписки
// ({{UnsubscribeUrl}} подставляет Unisender; обязательна для списочной отправки).
function template(opts: { heading: string; body: string; cta: string; link: string }): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
    <h1 style="font-size:22px;margin:0 0 16px">${opts.heading}</h1>
    <p style="font-size:15px;line-height:1.5;color:#444;margin:0 0 24px">${opts.body}</p>
    <a href="${opts.link}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;font-size:15px">${opts.cta}</a>
    <p style="font-size:13px;color:#888;margin:24px 0 0;line-height:1.5">Если кнопка не работает, скопируйте ссылку в браузер:<br><span style="color:${BRAND};word-break:break-all">${opts.link}</span></p>
    <p style="font-size:12px;color:#aaa;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px">Письмо отправлено по запросу на velizhanin.com. <a href="{{UnsubscribeUrl}}" style="color:#aaa">Отписаться</a></p>
  </div>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<MailResult> {
  const link = `${APP_URL}/verify-email?token=${token}`;
  return send(
    to,
    "Подтвердите почту — Велижанин AI",
    template({
      heading: "Подтвердите почту",
      body: "Остался один шаг. Нажмите кнопку ниже, чтобы подтвердить адрес и активировать аккаунт.",
      cta: "Подтвердить почту",
      link,
    }),
    link
  );
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<MailResult> {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return send(
    to,
    "Сброс пароля — Велижанин AI",
    template({
      heading: "Сброс пароля",
      body: "Вы запросили смену пароля. Нажмите кнопку ниже — ссылка действует 1 час. Если это были не вы, просто проигнорируйте письмо.",
      cta: "Задать новый пароль",
      link,
    }),
    link
  );
}
