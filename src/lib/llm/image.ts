import { recordStat } from "../stats";

// ── Генерация картинок (превью) через OpenRouter ────────────────────────────
// Отдельный эндпоинт OpenRouter `/api/v1/images` (не chat/completions): у него
// есть `input_references` (референсы image-to-image), `aspect_ratio`,
// `resolution` и `output_format` — ровно то, что нужно превью.
//
// Модель по умолчанию — Nano Banana Pro (google/gemini-3-pro-image): держит
// несколько субъектов с сохранением личности и, в отличие от 2.5-flash,
// нормально рендерит КИРИЛЛИЦУ (текст на превью русский — это критично).
// Меняется в админке (/admin/flags → «Модель генерации превью»).
//
// Движок чата (settings.provider) здесь ни при чём: превью всегда идут в
// OpenRouter, даже когда чат работает на Claude или GLM.

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export const IMAGE_DEFAULT_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-3-pro-image";

// jpeg, а не png: 2K-png выходит на 4-6 МБ, а YouTube принимает обложку до 2 МБ —
// пользователь всё равно не смог бы загрузить результат без пережатия.
const OUTPUT_FORMAT = "jpeg";
export const OUTPUT_MIME = "image/jpeg";
const RESOLUTION = "2K";
// ⚠️ Формат зависит от площадки проекта: YouTube — горизонталь, Instagram Reels —
// вертикаль. Обложка не «кадрируется» из 16:9: вертикальную композицию модель
// должна строить сразу, иначе спикер и текст окажутся за краем кадра.
const DEFAULT_ASPECT = "16:9";

const IMG_MAX_RETRIES = Math.max(0, Number(process.env.OPENROUTER_MAX_RETRIES ?? 3));
// Картинка генерится ощутимо дольше текста — таймаут отдельный и больше чатового.
const IMG_TIMEOUT_MS = Math.max(10000, Number(process.env.OPENROUTER_IMAGE_TIMEOUT_MS ?? 180000));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function backoffMs(attempt: number): number {
  return Math.min(8000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
}
function retryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export interface ImageReference {
  mime: string;
  base64: string;
}

export interface GenerateImageArgs {
  prompt: string;
  references?: ImageReference[];
  /** "16:9" для YouTube, "9:16" для Instagram Reels. */
  aspectRatio?: string;
  model?: string;
  meta?: { userId?: string | null; conversationId?: string | null };
}

export interface GeneratedImage {
  data: Buffer;
  mime: string;
  model: string;
  costUsd: number;
  latencyMs: number;
}

interface ImagesResponse {
  data?: { b64_json?: string; media_type?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
}

export async function generateImage({
  prompt,
  references = [],
  model,
  aspectRatio = DEFAULT_ASPECT,
  meta,
}: GenerateImageArgs): Promise<GeneratedImage> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Генератор превью не настроен: задай OPENROUTER_API_KEY");
  }
  const useModel = (model && model.trim()) || IMAGE_DEFAULT_MODEL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const body = JSON.stringify({
    model: useModel,
    prompt,
    n: 1,
    resolution: RESOLUTION,
    aspect_ratio: aspectRatio,
    output_format: OUTPUT_FORMAT,
    stream: false,
    // Референсы уходят base64 data-URL (файлы лежат у нас на диске, публичного
    // URL у них нет). Порядок = Image 1..N в промпте.
    ...(references.length
      ? {
          input_references: references.map((r) => ({
            type: "image_url",
            image_url: { url: `data:${r.mime};base64,${r.base64}` },
          })),
        }
      : {}),
  });

  const t0 = Date.now();

  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), IMG_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(`${OPENROUTER_BASE_URL}/images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": appUrl,
          "X-Title": "VELIZHANIN AI",
        },
        body,
        signal: ac.signal,
      });
    } catch (netErr) {
      clearTimeout(timer);
      const timedOut = ac.signal.aborted;
      if (attempt < IMG_MAX_RETRIES) {
        console.warn(
          `[image] ${timedOut ? `timeout (${IMG_TIMEOUT_MS}ms)` : "network error"}, retry ${attempt + 1}/${IMG_MAX_RETRIES}`
        );
        await sleep(backoffMs(attempt + 1));
        continue;
      }
      throw timedOut
        ? new Error(`Модель не ответила за ${Math.round(IMG_TIMEOUT_MS / 1000)}с`)
        : netErr;
    }
    clearTimeout(timer);

    if (!resp.ok) {
      if (retryable(resp.status) && attempt < IMG_MAX_RETRIES) {
        const ra = Number(resp.headers.get("retry-after"));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt + 1);
        console.warn(`[image] ${resp.status}, retry ${attempt + 1}/${IMG_MAX_RETRIES} in ${waitMs}ms`);
        await resp.text().catch(() => "");
        await sleep(waitMs);
        continue;
      }
      const errText = await resp.text().catch(() => "");
      throw new Error(`OpenRouter images ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const json = (await resp.json().catch(() => null)) as ImagesResponse | null;
    const first = json?.data?.[0];
    if (!first?.b64_json) {
      // Пустой ответ бывает, когда модель отказалась рисовать (сработали её
      // фильтры) — ретраить бессмысленно, отдаём понятную ошибку.
      const reason = json?.error?.message ?? "модель не вернула картинку";
      throw new Error(`Не удалось сгенерировать превью: ${reason}`);
    }

    const latencyMs = Date.now() - t0;
    const costUsd = json?.usage?.cost ?? 0;
    console.log(
      `[image] model=${useModel} refs=${references.length} total=${latencyMs}ms cost=$${costUsd.toFixed(4)}`
    );
    recordStat({
      kind: "image",
      provider: "openrouter",
      model: useModel,
      userId: meta?.userId,
      conversationId: meta?.conversationId,
      routeCategory: "thumbnail",
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
      costUsd,
      latencyMs,
    });

    return {
      data: Buffer.from(first.b64_json, "base64"),
      mime: first.media_type || OUTPUT_MIME,
      model: useModel,
      costUsd,
      latencyMs,
    };
  }
}
