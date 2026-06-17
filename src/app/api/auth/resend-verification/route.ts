import { NextResponse } from "next/server";
import { getSessionUser, createToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/mail";
import { apiError } from "@/lib/http";

// Повторная отправка письма подтверждения — только залогиненному и только
// если почта ещё не подтверждена.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);
  if (user.emailVerified) return NextResponse.json({ ok: true });

  const token = await createToken(user.id, "email_verify");
  await sendVerificationEmail(user.email, token);
  return NextResponse.json({ ok: true });
}
