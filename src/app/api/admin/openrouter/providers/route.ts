import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";

// Провайдеры (endpoints) конкретной модели OpenRouter — для пина под кэш в админке.
// Проксируем https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints, отдаём
// slug/имя + цену входа/кэша + поддержку implicit-кэша. По этим данным админ
// выбирает провайдера, у которого дешёвый кэш (напр. официальный DeepSeek). Только
// админ. slug провайдера для routing.order = префикс tag ("deepinfra/fp4" → "deepinfra").
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const model = new URL(req.url).searchParams.get("model")?.trim() ?? "";
  // Ждём "author/slug" (напр. "deepseek/deepseek-v4-flash").
  if (!/^[\w.-]+\/[\w.:-]+$/.test(model)) return apiError("Некорректная модель", 400);

  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  try {
    const res = await fetch(`${base}/models/${model}/endpoints`, {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      next: { revalidate: 600 },
    });
    if (!res.ok) return apiError("Не удалось получить провайдеров модели", 502);
    const data = (await res.json()) as {
      data?: {
        endpoints?: Array<{
          provider_name?: string;
          tag?: string;
          supports_implicit_caching?: boolean;
          pricing?: { prompt?: string; input_cache_read?: string };
        }>;
      };
    };

    // Уникальные провайдеры по slug; берём самый дешёвый по кэш-чтению endpoint.
    const bySlug = new Map<
      string,
      { slug: string; name: string; prompt: number; cacheRead: number | null; implicitCache: boolean }
    >();
    for (const e of data.data?.endpoints ?? []) {
      const slug = (e.tag?.split("/")[0] || e.provider_name || "").toLowerCase();
      if (!slug) continue;
      const prompt = Number(e.pricing?.prompt);
      const cr = e.pricing?.input_cache_read;
      const cacheRead = cr != null && cr !== "" ? Number(cr) : null;
      const cand = {
        slug,
        name: e.provider_name || slug,
        prompt: Number.isFinite(prompt) ? prompt : 0,
        cacheRead: cacheRead != null && Number.isFinite(cacheRead) ? cacheRead : null,
        implicitCache: Boolean(e.supports_implicit_caching),
      };
      const prev = bySlug.get(slug);
      // Оставляем вариант с бОльшим шансом на кэш: сперва implicit, потом дешевле кэш.
      if (
        !prev ||
        (cand.implicitCache && !prev.implicitCache) ||
        ((cand.cacheRead ?? Infinity) < (prev.cacheRead ?? Infinity))
      ) {
        bySlug.set(slug, cand);
      }
    }

    // Сортируем: сперва те, кто умеет implicit-кэш, потом по цене кэш-чтения.
    const providers = Array.from(bySlug.values()).sort((a, b) => {
      if (a.implicitCache !== b.implicitCache) return a.implicitCache ? -1 : 1;
      return (a.cacheRead ?? Infinity) - (b.cacheRead ?? Infinity);
    });
    return NextResponse.json({ providers });
  } catch (err) {
    console.error("[admin openrouter providers]", err);
    return apiError("Нет связи с OpenRouter", 502);
  }
}
