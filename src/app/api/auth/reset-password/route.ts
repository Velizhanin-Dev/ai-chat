import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeToken, hashPassword } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  if (password.length < 8) return apiError("Пароль минимум 8 символов");

  const userId = await consumeToken(token, "password_reset");
  if (!userId) return apiError("Ссылка недействительна или устарела");

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });
  return NextResponse.json({ ok: true });
}
