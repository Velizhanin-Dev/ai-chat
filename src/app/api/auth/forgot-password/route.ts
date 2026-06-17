import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/mail";
import { readJson, EMAIL_RE } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  const email = String(body?.email ?? "").trim().toLowerCase();

  // Письмо шлём, только если юзер есть, но ответ ВСЕГДА одинаковый — чтобы
  // нельзя было перебором узнать, какие адреса зарегистрированы.
  if (EMAIL_RE.test(email)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createToken(user.id, "password_reset");
      await sendPasswordResetEmail(email, token);
    }
  }
  return NextResponse.json({ ok: true });
}
