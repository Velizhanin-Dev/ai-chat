import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";

// Каталог моделей OpenRouter для селектора в админке. Проксируем публичный список
// (https://openrouter.ai/api/v1/models), отдаём урезанный вид (id/имя/контекст).
// Только админ. Кэшируем ответ на 10 минут (список меняется редко).
// `?output=image` — только модели, которые ОТДАЮТ картинки (для селектора модели
// генератора превью); без параметра — обычные текстовые модели чата.
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const wantImage = new URL(req.url).searchParams.get("output") === "image";
  try {
    const res = await fetch(`${base}/models${wantImage ? "?output_modalities=image" : ""}`, {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      next: { revalidate: 600 },
    });
    if (!res.ok) return apiError("Не удалось получить список моделей OpenRouter", 502);
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        supported_parameters?: string[];
      }>;
    };
    const models = (data.data ?? [])
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        context: m.context_length ?? 0,
        // Какие параметры генерации модель поддерживает — по ним рисуем крутилки.
        supportedParams: Array.isArray(m.supported_parameters)
          ? m.supported_parameters.filter((p): p is string => typeof p === "string")
          : [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ models });
  } catch (err) {
    console.error("[admin openrouter models]", err);
    return apiError("Нет связи с OpenRouter", 502);
  }
}
