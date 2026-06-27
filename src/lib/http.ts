import { NextResponse } from "next/server";

// Единый формат ошибки API: { error: string } (+ опц. машинный code) + http-статус.
export function apiError(error: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

// Безопасно достаём JSON-тело запроса (null, если тело пустое/битое).
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const EMAIL_RE = /^\S+@\S+\.\S+$/;
