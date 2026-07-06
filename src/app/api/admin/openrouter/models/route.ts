import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";

// Каталог моделей OpenRouter для селектора в админке. Проксируем публичный список
// (https://openrouter.ai/api/v1/models), отдаём урезанный вид (id/имя/контекст).
// Только админ. Кэшируем ответ на 10 минут (список меняется редко).
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  try {
    const res = await fetch(`${base}/models`, {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      next: { revalidate: 600 },
    });
    if (!res.ok) return apiError("Не удалось получить список моделей OpenRouter", 502);
    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string; context_length?: number }>;
    };
    const models = (data.data ?? [])
      .map((m) => ({ id: m.id, name: m.name || m.id, context: m.context_length ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ models });
  } catch (err) {
    console.error("[admin openrouter models]", err);
    return apiError("Нет связи с OpenRouter", 502);
  }
}
