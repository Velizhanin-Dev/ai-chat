import { recordStat } from "../stats";
import type { LlmStrategy, StreamArgs } from "./types";
import { MARKDOWN_FORMATTING } from "./formatting";

// GLM (Zhipu / Z.ai) — OpenAI-совместимый API. Ключ и эндпоинт берём из env.
// По умолчанию — международный домен z.ai; для bigmodel.cn поставь GLM_BASE_URL.
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4";
export const GLM_MODEL = process.env.GLM_MODEL || "glm-5.2";
const GLM_MAX_TOKENS = 16000;

// Директива форматирования (markdown) — общая с OpenRouter, см. ./formatting.ts
// (MARKDOWN_FORMATTING). Обе модели (GLM, DeepSeek) без неё выдают «плоские»
// монолиты. Навешивается ниже, в systemText, только на тематические запросы.

// ── Языковой гвард (чистый русский) ─────────────────────────────────────────
// GLM — китайская модель, и на длинной русской генерации протекает чужими
// токенами: вставляет иероглифы (泅 вместо «плаваешь»), английские слова
// («stepнёшь», «Named», «vending», «Roulette»), кальки (kit→«кит»), опечатки
// («Кловна» вместо «клоуна»). Claude этим не страдает. Промптом полностью не
// лечится (слабость модели), но заметно сокращается. Гвард идёт на ВСЕ ответы
// GLM (в т.ч. болтовню), в самый конец system — ближе к генерации.
const GLM_LANGUAGE = `# Язык — живой русский без иностранных вставок (жёстко)

Пиши целыми русскими словами, кириллицей. Это критично.

- НИКОГДА не вставляй иероглифы, латиницу или нерусские символы в середину слова или текста (никаких 泅, «stepнёшь», «Named», «vending», «Roulette», «kit»). Всплыло иностранное слово или иероглиф — замени русским ещё до выдачи: «step» → «шагнёшь», «kit» → «набор», «vending» → «автомат».
- Латиница — ТОЛЬКО в общепринятых названиях, которые по-русски так и пишут (YouTube, TikTok, reels, shorts, CTA, SEO), и целым словом, не вперемешку с кириллицей.
- Не коверкай слова и не делай опечаток авто-подстановки («Кловна», «泅таешь»). Каждое слово — нормальное русское слово.

ВАЖНО, чтобы не было противоречия с моим голосом: это правило — ТОЛЬКО про то, чтобы слова были русскими и целыми. Оно НЕ про вежливость и НЕ про литературность. Мой живой разговорный стиль, сленг, мат к месту, рубленые фразы, капс для акцента в хуках («ДОЛЬШЕ», «ТОНУТ») — всё это ОСТАЁТСЯ ровно как в блоке «Мой голос». «Без иностранных вставок» ≠ «приглаженно»: говори так же дерзко и по-своему, просто русскими словами.`;

// ── Авто-ретрай при перегрузе GLM ───────────────────────────────────────────
// Z.ai при превышении concurrency отбивает запрос (429) ещё на этапе admission,
// т.е. ДО первого токена. Пока пользователю не отдан ни один токен, повторная
// попытка невидима (он видит индикатор загрузки) — ретраим 429/5xx/таймаут/сеть.
// Как только пошёл текст — обрыв уже НЕ прячем (нельзя переписать показанное).
const GLM_MAX_RETRIES = Math.max(0, Number(process.env.GLM_MAX_RETRIES ?? 3));

// Таймаут на одну попытку: сколько ждём ОТВЕТА (первого байта), а после открытия
// стрима — сколько ждём КАЖДОГО следующего чанка (анти-залипание). Без него fetch на
// зависшем соединении Z.ai висит бесконечно, и пользователь ждёт «вечный ретрай».
// По истечении — AbortController рвёт запрос: до первого токена уходим в ретрай, после
// — пробрасываем ошибку (показанный текст не переписать). Настраивается через env.
const GLM_TIMEOUT_MS = Math.max(5000, Number(process.env.GLM_TIMEOUT_MS ?? 40000));

function glmSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Экспоненциальная пауза с джиттером: попытка 1→~0.6с, 2→~1.2с, 3→~2.4с (кап 4с).
// Джиттер размазывает повторы, чтобы толпа не долбила Z.ai синхронно.
function glmBackoffMs(attempt: number): number {
  const base = Math.min(4000, 600 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 300);
}

function glmRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

// Тарифы ($/M токенов) для оценки стоимости в логах — GLM-5.2
// (docs.z.ai/guides/overview/pricing: вход $1.4 / выход $4.4 / кэш-вход $0.26).
// Кэш у GLM автоматический (implicit), попадания приходят в
// usage.prompt_tokens_details.cached_tokens и считаются по льготному тарифу.
const PRICE_INPUT = 1.4;
const PRICE_OUTPUT = 4.4;
const PRICE_CACHED_INPUT = 0.26;

export type GlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

// Стоимость вызова GLM по usage ($). Кэш-попадания — по льготному тарифу.
export function glmCost(usage: GlmUsage | null | undefined): number {
  if (!usage) return 0;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = Math.max(0, prompt - cached);
  return (fresh * PRICE_INPUT + cached * PRICE_CACHED_INPUT + completion * PRICE_OUTPUT) / 1_000_000;
}

// Нестриминговый вызов (заголовок диалога, роутер): мысли отключаем (иначе съели
// бы бюджет и оставили content пустым). messages включают system первым элементом.
export async function glmComplete(
  messages: { role: string; content: string }[],
  maxTokens: number
): Promise<{ text: string; usage: GlmUsage | null }> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) throw new Error("GLM не настроен: задай GLM_API_KEY");
  const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GLM_MODEL,
      max_tokens: maxTokens,
      stream: false,
      thinking: { type: "disabled" },
      messages,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`GLM API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: GlmUsage;
  };
  return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage ?? null };
}

export const glmStrategy: LlmStrategy = {
  provider: "glm",
  async *stream({ system, messages, route, routeMs, meta }: StreamArgs) {
    const apiKey = process.env.GLM_API_KEY;
    if (!apiKey) {
      throw new Error("GLM не настроен: задай GLM_API_KEY (и при необходимости GLM_BASE_URL / GLM_MODEL)");
    }

    // Системные блоки Anthropic (с кэш-точками) → один system-месседж OpenAI-формата.
    // cache_control GLM игнорирует — берём только текст. В самый конец добавляем
    // GLM-специфичную директиву форматирования (см. GLM_FORMATTING) — она лечит
    // «плоские» ответы GLM, не трогая общий промпт и стратегию Claude. Но ТОЛЬКО на
    // тематических/разборных запросах (генерация, разбор методики) — болтовню
    // (`category === "chat"`: «как меня зовут», приветствия, спасибо) markdown-разметкой
    // не раздуваем, как и OUTPUT_DISCIPLINE в route.ts.
    const systemText = [
      ...system.map((b) => b.text).filter((t) => typeof t === "string" && t.length),
      ...(route.category !== "chat" ? [MARKDOWN_FORMATTING] : []),
      // Языковой гвард — на все ответы GLM (в т.ч. болтовню), в самый конец.
      GLM_LANGUAGE,
    ].join("\n\n");

    const oaMessages = [
      ...(systemText ? [{ role: "system" as const, content: systemText }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const requestBody = JSON.stringify({
      model: GLM_MODEL,
      messages: oaMessages,
      stream: true,
      max_tokens: GLM_MAX_TOKENS,
    });

    const t0 = Date.now();
    let firstTokenAt = 0;
    let outChars = 0;
    // usage GLM возвращает в последнем чанке стрима (choices пустой, есть usage).
    // Ловим оппортунистически — из любого чанка, где он есть.
    let usage: GlmUsage | null = null;

    // Открытие + чтение стрима с авто-ретраем. Повторяем, ПОКА firstTokenAt === 0
    // (пользователю ещё ничего не отдано) — тогда ретрай невидим. attempt 0 —
    // первая попытка, далее до GLM_MAX_RETRIES повторов с нарастающей паузой.
    for (let attempt = 0; ; attempt++) {
      // Таймер попытки: рвёт запрос, если ответ/следующий чанк не приходит вовремя.
      // Взводим перед fetch (таймаут первого байта), сбрасываем на каждый чанк.
      const ac = new AbortController();
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const armStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ac.abort(), GLM_TIMEOUT_MS);
      };
      const clearStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = null;
      };
      armStall();

      let resp: Response;
      try {
        resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: requestBody,
          signal: ac.signal,
        });
      } catch (netErr) {
        // Сетевой сбой ИЛИ таймаут до ответа — повторяем (токенов ещё не было).
        clearStall();
        const timedOut = ac.signal.aborted;
        if (attempt < GLM_MAX_RETRIES) {
          console.warn(
            `[chat] provider=glm ${timedOut ? `timeout (${GLM_TIMEOUT_MS}ms)` : "network error"}, retry ${attempt + 1}/${GLM_MAX_RETRIES}`
          );
          await glmSleep(glmBackoffMs(attempt + 1));
          continue;
        }
        throw timedOut
          ? new Error(`GLM timeout: нет ответа за ${GLM_TIMEOUT_MS}ms`)
          : netErr;
      }

      if (!resp.ok || !resp.body) {
        clearStall();
        if (glmRetryable(resp.status) && attempt < GLM_MAX_RETRIES) {
          // 429 = упёрлись в concurrency Z.ai; ждём слот (уважаем Retry-After).
          const ra = Number(resp.headers.get("retry-after"));
          const waitMs =
            Number.isFinite(ra) && ra > 0 ? ra * 1000 : glmBackoffMs(attempt + 1);
          console.warn(
            `[chat] provider=glm ${resp.status}, retry ${attempt + 1}/${GLM_MAX_RETRIES} in ${waitMs}ms`
          );
          await resp.text().catch(() => ""); // осушаем тело, чтобы не висло соединение
          await glmSleep(waitMs);
          continue;
        }
        const errText = await resp.text().catch(() => "");
        throw new Error(`GLM API ${resp.status}: ${errText.slice(0, 300)}`);
      }

      // Стрим открыт — читаем. Обрыв/залипание ДО первого токена тоже ретраим; после
      // первого токена — пробрасываем (показанный текст не переписать).
      armStall(); // заголовки пришли — полное окно на первый чанк
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            clearStall();
            break;
          }
          armStall(); // пришли байты — сбрасываем таймер залипания
          buffer += decoder.decode(value, { stream: true });

          // SSE: события разделены \n; держим неполную хвостовую строку в буфере.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            let parsed: {
              choices?: { delta?: { content?: string } }[];
              usage?: GlmUsage;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              // битый/частичный чанк — пропускаем (хвост уже сохранён в buffer)
              continue;
            }
            if (parsed.usage) usage = parsed.usage;
            // Берём только content. reasoning_content (если модель «думает») не
            // показываем — наружу идёт чистый ответ, как у claude-стратегии.
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              outChars += delta.length;
              yield delta;
            }
          }
        }
      } catch (readErr) {
        clearStall();
        const timedOut = ac.signal.aborted;
        if (firstTokenAt === 0 && attempt < GLM_MAX_RETRIES) {
          console.warn(
            `[chat] provider=glm stream ${timedOut ? `stalled (${GLM_TIMEOUT_MS}ms)` : "broke"} before first token, retry ${attempt + 1}/${GLM_MAX_RETRIES}`
          );
          await glmSleep(glmBackoffMs(attempt + 1));
          continue;
        }
        // После первого токена (или исчерпав ретраи) — пробрасываем: показанное не
        // переписать, а «залипший» стрим с частичным ответом лучше оборвать, чем висеть.
        throw timedOut && firstTokenAt
          ? new Error(`GLM stream stalled после ${GLM_TIMEOUT_MS}ms без новых токенов`)
          : readErr;
      }
      clearStall();
      break; // дочитали успешно — выходим из retry-цикла
    }

    const ttft = firstTokenAt ? firstTokenAt - t0 : -1;
    const total = Date.now() - t0;

    // Стоимость: prompt_tokens = весь вход (включая кэш-попадания); кэшированные
    // считаем по льготному тарифу, остальное — по полному. Если usage не пришёл —
    // фолбэк на outChars (без $).
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      const cost = glmCost(usage);
      console.log(
        `[chat] provider=glm model=${GLM_MODEL} route=${route.category} routeMs=${routeMs} ttft=${ttft}ms total=${total}ms cached=${cached} input=${promptTokens} output=${completionTokens} cost=$${cost.toFixed(4)}`
      );
      recordStat({
        kind: "chat",
        provider: "glm",
        model: GLM_MODEL,
        userId: meta?.userId,
        conversationId: meta?.conversationId,
        routeCategory: route.category,
        // promptTokens у GLM включает кэш-попадания; cachedTokens выделяем отдельно.
        inputTokens: Math.max(0, promptTokens - cached),
        outputTokens: completionTokens,
        cachedTokens: cached,
        costUsd: cost,
        latencyMs: total,
      });
    } else {
      console.log(
        `[chat] provider=glm model=${GLM_MODEL} route=${route.category} routeMs=${routeMs} ttft=${ttft}ms total=${total}ms outChars=${outChars} (usage недоступен)`
      );
      // usage не пришёл — пишем сам факт запроса (без токенов/стоимости).
      recordStat({
        kind: "chat",
        provider: "glm",
        model: GLM_MODEL,
        userId: meta?.userId,
        conversationId: meta?.conversationId,
        routeCategory: route.category,
        latencyMs: total,
      });
    }
  },
};
