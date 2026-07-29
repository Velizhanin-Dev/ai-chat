import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { routeQuery } from "@/lib/router";
import { getStrategy } from "@/lib/llm";
import { buildSystem } from "@/lib/llm/system";
import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";
import { sanitizeSpec, type ThumbnailIdeas } from "@/lib/thumbnails";
import {
  requireProjectAccess,
  checkQuota,
  spendQuota,
} from "@/lib/thumbnails-server";

// «Предложить заголовки» — текстовый шаг ПЕРЕД генерацией картинки: нейронка по
// методике (ВИСП, слабые слова, тавтология Н+П) отдаёт названия ролика, варианты
// текста НА превью и подсказки по кадру. Тратит 1 запрос квоты, как ответ в чате.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function extractIdeas(text: string): ThumbnailIdeas | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const str = (v: unknown, max = 300): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const titles = Array.isArray(o.titles)
    ? o.titles.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5)
    : [];
  const thumbTexts = Array.isArray(o.thumbTexts)
    ? o.thumbTexts
        .map((x) => {
          const it = (x ?? {}) as Record<string, unknown>;
          return {
            text: str(it.text, 80),
            keyWord: str(it.keyWord, 40),
            why: str(it.why, 200),
          };
        })
        .filter((x) => x.text.length > 0)
        .slice(0, 5)
    : [];
  if (!titles.length && !thumbTexts.length) return null;
  return {
    titles,
    thumbTexts,
    supportObject: str(o.supportObject, 200),
    emotion: str(o.emotion, 200),
    palette: str(o.palette, 200),
  };
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";

  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const denied = await checkQuota(access.user);
  if (denied) return denied.res;

  const spec = sanitizeSpec(body?.spec);
  const topic = [spec.videoSummary, spec.instructions].filter(Boolean).join("\n");
  if (!topic.trim()) return apiError("Опишите, о чём ролик");

  const conv = await prisma.conversation.findUnique({
    where: { id: access.conversationId },
    select: { brief: true },
  });
  const brief: Brief | null = isBriefComplete(sanitizeBrief(conv?.brief))
    ? sanitizeBrief(conv?.brief)
    : null;

  try {
    const settings = await getSettings();
    const provider = settings.provider;
    const routeHint =
      "придумай название ролика и текст на превью по ВИСП, подбери доп-элемент, эмоцию спикера и палитру под нишу";

    const tRoute0 = Date.now();
    const route = await routeQuery([{ role: "user", content: `${routeHint}. ${topic}` }], provider, {
      userId: access.user.id,
      conversationId: access.conversationId,
    });
    const routeMs = Date.now() - tRoute0;
    // Тот же тюнинг, что у ИИ-разбора видео: нужен слой ВИСП/превью (закрытый TG),
    // а книга со сценариями и форматы шортсов только раздувают промпт и латентность.
    route.category = "chat";
    route.book = false;
    route.formats = false;
    route.contentPlan = false;

    const userName = access.user.name?.trim().slice(0, 100) ?? "";
    const systemBlocks = buildSystem(route, route.searchQuery || routeHint, "", brief, userName);
    systemBlocks.push({
      type: "text",
      text: `# ФОРМАТ ЭТОЙ ЗАДАЧИ (важно)\nЭто не чат, а заготовка упаковки для превью. Верни ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг. Содержимое строк — живым моим языком и по моей методике. Не пиши ничего, кроме JSON.`,
    });

    const genPrompt = `Собери упаковку под превью для этого ролика.

О ЧЁМ РОЛИК:
${topic}
${spec.niche ? `\nНиша: ${spec.niche}` : ""}${spec.audience ? `\nЦА: ${spec.audience}` : ""}${
      spec.videoTitle ? `\nУже есть рабочее название: «${spec.videoTitle}»` : ""
    }

Верни СТРОГО валидный JSON без markdown и без текста вокруг:
{"titles":["...","...","..."],"thumbTexts":[{"text":"...","keyWord":"...","why":"..."}],"supportObject":"...","emotion":"...","palette":"..."}

Требования (всё по-русски, по методике):
- titles — 3 названия ролика по ВИСП. Рацио + поисковая часть, формула «триггерная часть + пояснительная». НЕ в два предложения, без точки в середине, без метафор и каламбуров, без ярлыков вроде «(шокирующее)».
- thumbTexts — 3 варианта текста НА превью. МАКСИМУМ 5 слов, лучше 3-4. Текст на превью не дублирует название (превью — эмоция и причастность, название — рацио и SEO). Каждый обязан проходить тест «и чё?». Выкинь слабые слова: правильный, актуальный, как, это, причины, безопасное, качественный, информация, точный.
  · keyWord — одно главное слово из этого текста (то, при удалении которого фраза сильнее всего рушится), оно пойдёт капсом на превью.
  · why — одной строкой, почему на это кликнут.
- supportObject — ОДИН доп-элемент среднего плана, осмысленный и триггерящий (не иллюстрация слова в лоб). Одна превью — одна идея.
- emotion — эмоция и поза спикера, конгруэнтные теме.
- palette — палитра словами + коротко почему именно она под эту нишу и ЦА.
Только JSON, ничего кроме него.`;

    const strategy = getStrategy(provider);
    let full = "";
    for await (const token of strategy.stream({
      system: systemBlocks,
      messages: [{ role: "user", content: genPrompt }],
      route,
      routeMs,
      model: settings.openrouterModel,
      orParams: settings.openrouterParams,
      orProvider: settings.openrouterProvider,
      meta: { userId: access.user.id, conversationId: access.conversationId },
    })) {
      full += token;
    }

    const ideas = extractIdeas(full);
    if (!ideas) {
      console.error("[thumbnails spec] parse failed:", full.slice(0, 300));
      return apiError("Не удалось разобрать ответ модели, попробуйте ещё раз", 502);
    }

    await spendQuota(access.user);
    return NextResponse.json({ ideas });
  } catch (err) {
    console.error("[thumbnails spec]", err);
    return apiError("Не удалось подобрать заголовки", 502);
  }
}
