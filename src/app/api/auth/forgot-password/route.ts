import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { sendPasswordResetEmail, mailConfigured } from "@/lib/mail";
import { notifyMailFailure } from "@/lib/telegram";
import { apiError, readJson, EMAIL_RE } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  const email = String(body?.email ?? "").trim().toLowerCase();

  // Почта не настроена вовсе — честно говорим, что сейчас не выйдет, вместо
  // «проверьте почту» в никуда. Энумерации тут нет: проверка не зависит от того,
  // существует ли аккаунт, поэтому ответ одинаков для любого адреса.
  if (!mailConfigured()) {
    console.error("[forgot-password] почта не настроена — сброс пароля невозможен");
    return apiError(
      "Отправка писем сейчас недоступна. Напишите в поддержку — восстановим доступ вручную.",
      503,
      "MAIL_UNAVAILABLE"
    );
  }

  // Письмо шлём, только если юзер есть, но ответ ВСЕГДА одинаковый — чтобы
  // нельзя было перебором узнать, какие адреса зарегистрированы.
  if (EMAIL_RE.test(email)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createToken(user.id, "password_reset");
      const res = await sendPasswordResetEmail(email, token);
      // ⚠️ Сбой отправки наружу НЕ показываем: сюда мы попадаем, только если
      // аккаунт существует, и ошибка в ответе выдала бы этот факт. Поэтому зовём
      // администратора в телеграм — человек остался без письма и сам об этом не
      // узнает, а причина всегда на нашей стороне.
      if (res !== "sent") {
        console.error(`[forgot-password] письмо не отправлено (${res})`);
        void notifyMailFailure({
          kind: "Сброс пароля",
          reason:
            res === "not_configured"
              ? "не заданы UNISENDER_API_KEY / UNISENDER_LIST_ID"
              : "Unisender отклонил отправку — смотри [mail] в логах сервера",
        }).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true });
}
