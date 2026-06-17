import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  const token = String(body?.token ?? "");

  const userId = await consumeToken(token, "email_verify");
  if (!userId) return apiError("Ссылка недействительна или устарела");

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: new Date() },
  });
  return NextResponse.json({ ok: true });
}
