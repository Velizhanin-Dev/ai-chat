import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resolveChannel, fetchChannelUploads } from "@/lib/youtube-search";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked, structuredModelOf } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { BRIEF_LIMITS, type BriefAutofill } from "@/lib/brief";
import { getStrategy } from "@/lib/llm";
import type { RouteDecision } from "@/lib/router";
import {
  getPendingConnection,
  getPendingAccessToken,
  getValidAccessToken,
  fetchChannelInfo,
  fetchRecentVideos,
  assertOwnedProject,
} from "@/lib/youtube";

// Автозаполнение брифа по подключённому YouTube-каналу. Вызывается на шаге брифа
// сразу после подключения канала: тянем канал + последние ролики и просим модель
// вытащить из них поля брифа (ниша, продукт, аудитория, экспертность, цель).
//
// Источник токена: черновое подключение юзера (шаг брифа, проекта ещё нет) или,
// если передан projectId, — интеграция этого проекта (перезаполнение брифа).
//
// Квоту НЕ тратит: это онбординг до создания проекта, брать за него запрос нечестно
// (стоимость всё равно видна в телеметрии — стратегия пишет Stat сама).

// Сколько роликов и символов описаний отдаём модели — потолок на объём промпта.
const VIDEOS_FOR_HINT = 20;
const CHANNEL_DESC_MAX = 1200;
const VIDEO_DESC_MAX = 400;

// Достаём JSON из ответа модели (может прийти в ```json-обёртке или с текстом
// вокруг) и режем по лимитам полей брифа.
function extractAutofill(text: string, fallbackChannel: string): BriefAutofill | null {
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
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
  const filled: BriefAutofill = {
    channel: str(o.channel, BRIEF_LIMITS.channel) || fallbackChannel,
    niche: str(o.niche, BRIEF_LIMITS.niche),
    product: str(o.product, BRIEF_LIMITS.product),
    audience: str(o.audience, BRIEF_LIMITS.audience),
    expertise: str(o.expertise, BRIEF_LIMITS.expertise),
    goal: str(o.goal, BRIEF_LIMITS.goal),
    cameraExp: "",
  };
  // Ни одного содержательного поля — считаем разбор неудачным.
  if (!filled.niche && !filled.product && !filled.audience && !filled.expertise) return null;
  return filled;
}

// Нормализованные факты канала: одинаковы для OAuth-пути и пути «по ссылке».
interface ChannelFacts {
  title: string;
  customUrl: string | null;
  hiddenSubscribers: boolean;
  subscribers: number;
  videoCount: number;
  views: number;
  description: string;
  videoLines: string;
  topTitles: string;
}

// Сам вызов модели. Вынесен из OAuth-ветки, когда появился путь «по ссылке»:
// промпт и парсинг у обоих путей одинаковы до буквы, различается только то,
// откуда взяты факты.
async function runAutofill(
  settings: Awaited<ReturnType<typeof getSettings>>,
  userId: string,
  facts: ChannelFacts
): Promise<BriefAutofill | null> {
  const prompt = `Вот данные YouTube-канала. Вытащи из них бриф проекта.

КАНАЛ
Название: ${facts.title}
Ссылка: ${facts.customUrl ?? "—"}
Подписчиков: ${facts.hiddenSubscribers ? "скрыто" : facts.subscribers}
Роликов: ${facts.videoCount}, суммарных просмотров: ${facts.views}
Описание канала:
«${facts.description ? facts.description.slice(0, CHANNEL_DESC_MAX) : "(пустое)"}»

ПОСЛЕДНИЕ РОЛИКИ (название — просмотры):
${facts.videoLines}

Свежие темы: ${facts.topTitles.slice(0, VIDEO_DESC_MAX) || "—"}

Верни СТРОГО валидный JSON без markdown и без текста вокруг:
{"channel":"...","niche":"...","product":"...","audience":"...","expertise":"...","goal":"..."}

Правила:
- channel — название канала/проекта как есть.
- niche — чем человек занимается, сфера (1 фраза, до 200 символов).
- product — что он продвигает/продаёт через YouTube. Если в описании канала есть продукт, услуга, курс, консультация или лид-магнит — назови его. Если нигде не видно — пустая строка.
- audience — кто смотрит и покупает: пол, возраст, чем живут, что у них болит (2-3 фразы, выводи из тем роликов).
- expertise — в чём он силён как спикер, о чём говорит уверенно (выводи из повторяющихся тем).
- goal — зачем ему YouTube (продажи, лиды, личный бренд, охваты) — по описанию и призывам.
- Пиши по-русски, простым живым языком, от третьего лица про канал (не «я»).
- НЕ выдумывай фактов, которых нет в данных: не знаешь — пустая строка. Лучше пусто, чем придумано.
Только JSON, ничего кроме него.`;

  // Служебный вызов: база знаний тут не нужна (это извлечение фактов, не генерация
  // контента) — все слои off, category "chat" → у Claude не включается thinking.
  const route: RouteDecision = {
    category: "chat",
    formats: false,
    tgClosed: false,
    tgOpen: false,
    book: false,
    youtube: false,
    contentPlan: false,
    charisma: false,
    searchQuery: "",
  };

  const strategy = getStrategy(settings.provider);
  let full = "";
  for await (const token of strategy.stream({
    system: [
      {
        type: "text",
        text: `Ты — аналитик YouTube-каналов. Твоя задача: по данным канала (название, описание, темы роликов) восстановить бриф его владельца — ниша, продукт, аудитория, экспертность, цель.
Ты НЕ пишешь контент и НЕ даёшь советов. Ты возвращаешь ТОЛЬКО валидный JSON по схеме из сообщения пользователя — без markdown-обёртки, без преамбул и без текста вокруг.
Главное правило: не выдумывай. Если данных на поле не хватает — верни по нему пустую строку.`,
      },
    ],
    messages: [{ role: "user", content: prompt }],
    route,
    routeMs: 0,
    model: structuredModelOf(settings).model,
    orParams: settings.openrouterParams,
    orProvider: structuredModelOf(settings).orProvider,
    meta: { userId, conversationId: null },
  })) {
    full += token;
  }

  const autofill = extractAutofill(full, facts.title);
  if (!autofill) console.error("[brief autofill] parse failed:", full.slice(0, 300));
  return autofill;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";

  // ── Ветка «по ссылке»: канал на бренд-аккаунте, OAuth человеку недоступен ──
  // Все данные для автозаполнения публичны (название, описание, темы роликов),
  // поэтому токен тут не нужен вовсе. Возвращаем заодно channelId — клиент
  // передаст его в создание проекта, и канал привяжется как ChannelLink.
  const channelUrl = typeof body?.channelUrl === "string" ? body.channelUrl.trim().slice(0, 300) : "";
  if (channelUrl && !projectId) {
    try {
      const found = await resolveChannel(channelUrl);
      if (!found) {
        return apiError(
          "Не нашёл такой канал. Скопируйте ссылку из адресной строки канала на YouTube.",
          422,
          "YT_LINK_NOT_FOUND"
        );
      }
      const uploads = await fetchChannelUploads(found.id, VIDEOS_FOR_HINT).catch(() => []);
      const autofill = await runAutofill(settings, user.id, {
        title: found.title,
        customUrl: found.customUrl,
        hiddenSubscribers: found.hiddenSubscribers,
        subscribers: found.subscribers,
        videoCount: found.videoCount,
        views: found.views,
        description: found.description,
        videoLines: uploads.length
          ? uploads.map((v) => `- «${v.title}» — ${v.views} просмотров`).join("\n")
          : "(роликов пока нет)",
        topTitles: uploads.slice(0, 3).map((v) => v.title).join(" | "),
      });
      if (!autofill) {
        return apiError("Не удалось разобрать канал, заполните бриф вручную", 502, "AUTOFILL_FAILED");
      }
      autofill.cameraExp = found.videoCount >= 15 ? "pro" : found.videoCount > 0 ? "some" : "";
      return NextResponse.json({
        autofill,
        linkChannel: { channelId: found.id, title: found.title, thumbnail: found.thumbnail },
      });
    } catch (err) {
      console.error("[brief autofill] link path:", err);
      return apiError("Не удалось разобрать канал по ссылке", 502, "YT_ERROR");
    }
  }

  // Токен: интеграция проекта (если просят по проекту) или черновик юзера.
  let accessToken: string;
  try {
    if (projectId) {
      const owned = await assertOwnedProject(user.id, projectId);
      if (!owned) return apiError("Проект не найден", 404);
      const integ = await prisma.youTubeIntegration.findUnique({
        where: { conversationId: owned },
      });
      if (!integ) return apiError("YouTube не подключён", 404, "YT_NOT_CONNECTED");
      accessToken = await getValidAccessToken(integ);
    } else {
      const pending = await getPendingConnection(user.id);
      if (!pending) return apiError("YouTube не подключён", 404, "YT_NOT_CONNECTED");
      accessToken = await getPendingAccessToken(pending);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "no_refresh_token" || msg === "token_refresh_failed") {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[brief autofill] token", err);
    return apiError("Не удалось получить доступ к каналу", 502, "YT_ERROR");
  }

  try {
    const channel = await fetchChannelInfo(accessToken);
    if (!channel) return apiError("Канал не найден", 404, "YT_ERROR");

    const videos = channel.uploadsPlaylistId
      ? (await fetchRecentVideos(accessToken, channel.uploadsPlaylistId, VIDEOS_FOR_HINT)).videos
      : [];

    const autofill = await runAutofill(settings, user.id, {
      title: channel.title,
      customUrl: channel.customUrl,
      hiddenSubscribers: channel.hiddenSubscriberCount,
      subscribers: channel.subscriberCount,
      videoCount: channel.videoCount,
      views: channel.viewCount,
      description: channel.description ?? "",
      videoLines: videos.length
        ? videos.map((v) => `- «${v.title}» — ${v.viewCount} просмотров`).join("\n")
        : "(роликов пока нет)",
      // Названия первых роликов дают контекст про продукт/оффер.
      topTitles: videos.slice(0, 3).map((v) => v.title).join(" | "),
    });
    if (!autofill) {
      return apiError("Не удалось разобрать канал, заполните бриф вручную", 502, "AUTOFILL_FAILED");
    }

    // Опыт на камере выводим из числа опубликованных роликов (модель про человека
    // перед камерой из данных API судить не может). Юзер поправит на своём экране.
    autofill.cameraExp =
      channel.videoCount >= 15 ? "pro" : channel.videoCount > 0 ? "some" : "";

    return NextResponse.json({
      autofill,
      channel: {
        channelId: channel.channelId,
        title: channel.title,
        thumbnail: channel.thumbnail,
        customUrl: channel.customUrl,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      return apiError("Нужно переподключить YouTube", 409, "YT_REAUTH");
    }
    console.error("[brief autofill]", err);
    return apiError("Не удалось разобрать канал", 502, "YT_ERROR");
  }
}
