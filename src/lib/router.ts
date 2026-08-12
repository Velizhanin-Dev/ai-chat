/**
 * Роутер запросов: решает, какие слои знаний подгружать под конкретный запрос,
 * чтобы НЕ грузить всю базу в каждый вызов. См. docs/context-cost-plan.md (Фаза 1).
 *
 * Классификатор — дешёвый вызов Haiku (голос там не нужен). При ошибке/таймауте —
 * откат на keyword-эвристику. Хребет (system-промпт + voice + антипаттерны) грузится
 * ВСЕГДА и здесь не участвует — здесь только «полка-фактура».
 */
import { getAnthropic } from "./anthropic";
import { recordStat } from "./stats";
import { HAIKU_MODEL, haikuCost } from "./llm/claude";
import { GLM_MODEL, glmComplete, glmCost } from "./llm/glm";
import type { LlmProvider } from "./llm/types";

export type QueryCategory =
  | "chat"
  | "short"
  | "long"
  | "method"
  | "content_plan"
  | "ideas";

type RouterMeta = { userId?: string | null; conversationId?: string | null };

export interface RouteDecision {
  category: QueryCategory;
  /** Какие статичные слои подключить целиком. */
  formats: boolean;
  tgClosed: boolean;
  tgOpen: boolean;
  /** Нужен ли поиск по книге (динамические куски). */
  book: boolean;
  /** Ретрив по транскриптам моих YouTube-роликов (широкий слой: воронка/ниши/
   *  названия/превью/сценарий/харизма/шортсы/проявленность). */
  youtube: boolean;
  /** Подключить эталон контент-плана (месячная сетка роликов). */
  contentPlan: boolean;
  /** Подключить карту харизмы (9 типов DISC) — ТОЛЬКО когда про неё спросили явно.
   *  В обычной работе тип применяется молча, внутри артефакта. */
  charisma: boolean;
  /** Запрос для поиска по книге/форматам — расширен ключевыми словами от роутера. */
  searchQuery: string;
}

const ROUTER_SYSTEM = `Ты — классификатор запросов к ассистенту по созданию YouTube-контента.
Классифицируй ПОСЛЕДНЕЕ сообщение пользователя. Контекст переписки используй ТОЛЬКО
чтобы понять короткие уточнения-продолжения (вроде «сделай короче», «а для рилса?»,
«ещё вариант»). Приветствие, благодарность или болтовня — это ВСЕГДА chat, даже если
до этого обсуждали сценарий.
Ответь РОВНО одним словом из списка, без пояснений и знаков препинания:

- chat — приветствие, болтовня, благодарность, мета-вопрос о тебе, короткое уточнение без новой темы.
- short — просьба придумать/написать сценарий, хук, идею, превью или название для КОРОТКОГО видео (рилс, reels, шортс, shorts, tiktok, тикток, клип, ВИСП).
- long — просьба про сценарий/структуру/хук/удержание ДЛИННОГО видео (YouTube 5+ минут, ролик, лонг, выпуск).
- ideas — просьба придумать ТЕМЫ / идеи роликов / варианты НАЗВАНИЯ / текст на превью, БЕЗ полного сценария и БЕЗ месячной сетки («накидай идей», «придумай 7 названий», «о чём снять», «дай темы»).
- content_plan — просьба собрать КОНТЕНТ-ПЛАН / контент план / сетку роликов / план на месяц / список тем роликов с раскруткой (несколько видео сразу, а не один сценарий).
- method — вопрос по методике/теории без генерации артефакта (удержание, темы, превью, монтаж, SEO, продвижение, как работает YouTube).

Формат ответа: «<категория> | <5–8 ключевых слов и синонимов для поиска, через пробел>».
Ключевые слова — на русском, только для short/long/method (для chat не нужны — «chat |»).
Их задача — попасть в формулировки моей базы знаний, поэтому НЕ дублируй слова запроса
один в один, а РАСШИРЯЙ их:
- добавляй синонимы и как это называется у меня в базе: вовлечённость → удержание
  досматриваемость; зацепка/цепляет → хук крючок заход; обложка/картинка → превью;
  идея/тема → рубрика формат; начало → первые секунды;
- подмешивай мою терминологию, если она к месту: удержание, ВИСП, крючок, хук, превью,
  монтаж, сценарий, кубики, КМК, Матрица Дайсона, рилс, шортс, досматриваемость.
Не добавляй термины не по теме — только релевантные запросу.
Примеры:
«long | удержание досматриваемость вовлечение зритель первые секунды хук крючок»,
«short | рилс идея хук зацепка заход вирусность формат»,
«ideas | темы идеи названия превью триггер ВИСП боль ца кликабельность CTR»,
«content_plan | контент-план сетка ролики темы месяц названия превью лестница ханта боль ца», «chat |».`;

function mapCategory(category: QueryCategory): RouteDecision {
  const base: RouteDecision = {
    category,
    formats: false,
    tgClosed: false,
    tgOpen: false,
    book: false,
    youtube: false,
    contentPlan: false,
    charisma: false,
    searchQuery: "",
  };
  // YouTube-транскрипты — широкий разговорный слой, релевантен любой генерации/
  // методике (воронка, ниши, названия, превью, сценарий, харизма, шортсы). Включаем
  // на все не-chat категории; болтовню (chat) им не раздуваем.
  switch (category) {
    case "short":
      // Короткие видео: подходящий формат + закрытый TG (ВИСП, рилсы, шортсы).
      return { ...base, formats: true, tgClosed: true, youtube: true };
    case "content_plan":
      // Контент-план: эталон месячной сетки + книга (темы/боли/удержание) +
      // закрытый TG (ВИСП — движок кликбейт-названий и текста на превью).
      return { ...base, contentPlan: true, book: true, tgClosed: true, youtube: true };
    case "ideas":
      // Темы / идеи / названия / текст на превью. Весь движок упаковки живёт в
      // закрытом TG (банк слов ВИСП, порядок сборки названия, слабые слова под нож,
      // банк залетевших названий) + глава книги про техники превью. Эталон месячной
      // сетки НЕ грузим: просят идеи, а не план — иначе ответ уедет в формат таблицы.
      return { ...base, book: true, tgClosed: true, youtube: true };
    case "long":
    case "method":
      // Длинные сценарии и методика: релевантные куски книги (поиск) + закрытый TG.
      // ⚠️ tgClosed тут ОБЯЗАТЕЛЕН: раньше на «напиши сценарий» слой ВИСП/названий
      // не грузился вообще, и модель собирала упаковку из общих копирайтерских
      // шаблонов вместо моих формулировок. Слой режется бюджетом ретрива (~30k
      // символов), промпт не взрывается.
      return { ...base, book: true, tgClosed: true, youtube: true };
    case "chat":
    default:
      // Болтовня: только хребет, ничего не подгружаем.
      return { ...base, category: "chat" };
  }
}

/**
 * Спросили ли ПРЯМО про карту харизмы / типы личности.
 *
 * Отдельным флагом, а не категорией роутера: слой тяжёлый (все 9 типов) и нужен
 * редко, а лишний вызов LLM тут не нужен — вопрос всегда содержит одно из этих слов.
 *
 * ⚠️ Набор намеренно узкий. Слова «звезда», «император», «сердечный» — названия
 * архетипов, но в обычной речи встречаются сплошь и рядом («сделай про звёзд»), и по
 * ним слой цеплялся бы к половине запросов.
 */
export function asksAboutCharisma(text: string): boolean {
  // ⚠️ Окончания перечисляем классом [а-яё], а НЕ через \w: в JS без флага `u`
  // \w — это [A-Za-z0-9_], кириллицу он не матчит, и «очаровательную акулу» мимо.
  return /(харизм|\bdisc\b|тип(?:а|ы|ов|у)? личност|типаж|архетип|кот леопольд|айрон ?фист|iron ?fist|очаровательн[а-яё]* акул|кайфушник|жизнь в кайф|самый последовательн)/i.test(
    text
  );
}

/** Грубая keyword-эвристика на случай ошибки LLM-роутера. */
function heuristicCategory(text: string): QueryCategory {
  const t = text.toLowerCase();
  const isPlan =
    /(контент[\s-]?план|контентплан|сетк[аиу] ролик|план (?:роликов|на месяц|видео)|плана роликов|тем[ыу] на месяц|темы на \d)/.test(
      t
    );
  const isShort = /(рилс|reels|шортс|shorts|tiktok|тикток|висп|клип)/.test(t);
  const wantsGen =
    /(сценари|напиши|придума|сделай|сгенер|накида|накин|подкин|накидыв|дай \d|дай идей|дай тем|хук|заход|иде[яюийе]|сними|превью|назван|заголов|вариант)/.test(
      t
    );
  // Просят ТЕМЫ/НАЗВАНИЯ, а не сценарий — отдельная ветка: там нужен слой упаковки
  // (ВИСП, банк триггеров, банк залетевших названий), а не структура длинного видео.
  const isScenario = /(сценари|структур[ауы] ролик|раскадров|по секунд)/.test(t);
  const isIdeas =
    !isScenario &&
    /(иде[яюийе]|темы|тему|тем для|тем на|о чём снять|о чем снять|про что снять|назван|заголов|превью)/.test(
      t
    );
  if (isPlan) return "content_plan";
  if (isShort) return "short";
  if (isIdeas) return "ideas";
  if (wantsGen && /(ролик|видео|лонг|выпуск|youtube|ютуб|канал)/.test(t)) return "long";
  if (wantsGen) return "long";
  if (/(как|почему|что такое|зачем|удержани|монтаж|seo|продвиж|тег|алгоритм)/.test(t)) return "method";
  return "chat";
}

const VALID: QueryCategory[] = [
  "chat",
  "short",
  "long",
  "method",
  "content_plan",
  "ideas",
];

// Таймаут LLM-роутера: провайдер (особенно GLM/OpenRouter под нагрузкой) может
// зависнуть, а сам вызов classify без ограничения ждёт вечно и блокирует ответ.
// По таймауту бросаем — routeQuery ловит и откатывается на keyword-эвристику.
const ROUTER_TIMEOUT_MS = 6_000;
function withRouterTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("router_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const GEN_RE =
  /(сценари|напиши|придума|сделай|хук|заход|идею|идей|превью|назван|рилс|шортс|reels|shorts|tiktok|тикток|клип|висп|ролик|видео|выпуск|лонг|контент[\s-]?план|сетк)/;
const CHAT_RE =
  /(привет|здаров|здоров|хай|добрый день|доброе утро|добрый вечер|как дела|как сам|как ты|как жизнь|спасибо|спс|благодар|пока|до свидан|понятно|^ок$|окей|ясно|круто|класс|супер|хорошо|норм)/;

/**
 * Детерминированный fast-path для очевидной болтовни: короткое сообщение с
 * приветствием/благодарностью и без генеративных слов → chat, без вызова LLM
 * (экономит латентность и страхует от того, что роутер переоценит контекст).
 */
function isObviousChat(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (t.length > 80) return false;
  if (GEN_RE.test(t)) return false;
  return CHAT_RE.test(t);
}

const EDIT_RE =
  /(переделай|перепиш|короче|длиннее|острее|жёстче|жестче|мягче|ещё вариант|еще вариант|другой вариант|по-другому|по другому|сократи|поправь|исправь)/;

/**
 * Короткая правка предыдущего результата («сделай короче», «острее», «другой
 * вариант») — НЕ перезагружаем книгу/форматы: исходник уже в истории диалога,
 * а она кэшируется. Дешевле и консистентнее (правим тот же текст). Только чистые
 * трансформации; «добавь про X» сюда НЕ входит — там может понадобиться книга.
 */
function isEditFollowup(
  text: string,
  messages: { role: "user" | "assistant"; content: string }[]
): boolean {
  if (!messages.some((m) => m.role === "assistant")) return false;
  const t = text.toLowerCase().trim();
  if (t.length > 70) return false;
  return EDIT_RE.test(t);
}

/**
 * Классификация запроса ГЛОБАЛЬНЫМ движком (claude haiku или glm). Возвращает
 * сырой текст «<категория> | <ключевые слова>» и пишет телеметрию (kind=router).
 */
async function classify(
  provider: LlmProvider,
  ctx: { role: "user" | "assistant"; content: string }[],
  meta: RouterMeta
): Promise<string> {
  if (provider === "glm") {
    const { text, usage } = await glmComplete(
      [{ role: "system", content: ROUTER_SYSTEM }, ...ctx],
      40
    );
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    recordStat({
      kind: "router",
      provider: "glm",
      model: GLM_MODEL,
      userId: meta.userId,
      conversationId: meta.conversationId,
      inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
      outputTokens: usage?.completion_tokens ?? 0,
      cachedTokens: cached,
      costUsd: glmCost(usage),
    });
    return text;
  }
  const resp = await getAnthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 40,
    system: ROUTER_SYSTEM,
    messages: ctx.map((m) => ({ role: m.role, content: m.content })),
  });
  const raw = resp.content.find((b) => b.type === "text");
  recordStat({
    kind: "router",
    provider: "claude",
    model: HAIKU_MODEL,
    userId: meta.userId,
    conversationId: meta.conversationId,
    inputTokens: resp.usage.input_tokens ?? 0,
    outputTokens: resp.usage.output_tokens ?? 0,
    costUsd: haikuCost(resp.usage.input_tokens ?? 0, resp.usage.output_tokens ?? 0),
  });
  return raw && raw.type === "text" ? raw.text : "";
}

/**
 * Классифицировать запрос и вернуть, какие слои грузить. messages — последние
 * сообщения диалога (для контекста follow-up вроде «сделай короче»). provider —
 * глобальный движок (из настроек админки), meta — атрибуция для телеметрии.
 */
export async function routeQuery(
  messages: { role: "user" | "assistant"; content: string }[],
  provider: LlmProvider = "claude",
  meta: RouterMeta = {}
): Promise<RouteDecision> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // Про типы харизмы спрашивают явно — флаг считаем по тексту, до всех веток:
  // вопрос «а какие вообще бывают типы?» проходит и как болтовня, и как правка.
  const charisma = asksAboutCharisma(lastUser);
  // Очевидная болтовня — сразу chat, без вызова LLM-роутера.
  if (isObviousChat(lastUser)) return { ...mapCategory("chat"), charisma };
  // Правка предыдущего результата — не перезагружаем слои (исходник в истории,
  // она в кэше). category "long" → thinking остаётся включён, но book=false.
  if (isEditFollowup(lastUser, messages)) {
    const d = mapCategory("long");
    d.book = false;
    d.youtube = false;
    d.charisma = charisma;
    d.searchQuery = lastUser;
    return d;
  }
  // Контекст: последние до 4 реплик, чтобы понять follow-up.
  const ctx = messages.slice(-4);
  try {
    const out = await withRouterTimeout(classify(provider, ctx, meta), ROUTER_TIMEOUT_MS);
    const [catPart, ...kw] = out.split("|");
    // ⚠️ Подчёркивание НЕ срезаем: раньше было /[^a-z]/g, и «content_plan» от роутера
    // превращался в «contentplan», не проходил VALID.includes и МОЛЧА откатывался на
    // грубую keyword-эвристику. То есть корректная классификация контент-плана
    // выбрасывалась всегда, а «накидай тем на месяц» уезжало в chat (ноль слоёв базы).
    const word = catPart.toLowerCase().trim().replace(/[^a-z_]/g, "");
    const keywords = kw.join("|").trim();
    const category = (VALID.includes(word as QueryCategory)
      ? word
      : heuristicCategory(lastUser)) as QueryCategory;
    const decision = mapCategory(category);
    decision.charisma = charisma;
    // Поисковый запрос = ключевые слова от роутера + сам вопрос (расширение recall).
    decision.searchQuery = `${keywords} ${lastUser}`.trim();
    return decision;
  } catch {
    const decision = mapCategory(heuristicCategory(lastUser));
    decision.charisma = charisma;
    decision.searchQuery = lastUser;
    return decision;
  }
}

// Режим «полный промпт»: без LLM-классификации и без BM25-роутинга — все слои on,
// всю базу отдаём целиком (см. buildFullSystem). Категорию берём дешёвой эвристикой:
// очевидная болтовня → "chat" (без OUTPUT_DISCIPLINE/thinking), иначе "long".
export function fullModeRoute(lastUser: string): RouteDecision {
  return {
    category: isObviousChat(lastUser) ? "chat" : "long",
    formats: true,
    tgClosed: true,
    tgOpen: true,
    book: true,
    youtube: true,
    contentPlan: true,
    charisma: true,
    searchQuery: lastUser,
  };
}
