/**
 * Роутер запросов: решает, какие слои знаний подгружать под конкретный запрос,
 * чтобы НЕ грузить всю базу в каждый вызов. См. docs/context-cost-plan.md (Фаза 1).
 *
 * Классификатор — дешёвый вызов Haiku (голос там не нужен). При ошибке/таймауте —
 * откат на keyword-эвристику. Хребет (system-промпт + voice + антипаттерны) грузится
 * ВСЕГДА и здесь не участвует — здесь только «полка-фактура».
 */
import { getAnthropic } from "./anthropic";

export type QueryCategory = "chat" | "short" | "long" | "method";

export interface RouteDecision {
  category: QueryCategory;
  /** Какие статичные слои подключить целиком. */
  formats: boolean;
  tgClosed: boolean;
  tgOpen: boolean;
  /** Нужен ли поиск по книге (динамические куски). */
  book: boolean;
  /** Запрос для поиска по книге/форматам — расширен ключевыми словами от роутера. */
  searchQuery: string;
}

const ROUTER_MODEL = "claude-haiku-4-5";

const ROUTER_SYSTEM = `Ты — классификатор запросов к ассистенту по созданию YouTube-контента.
Классифицируй ПОСЛЕДНЕЕ сообщение пользователя. Контекст переписки используй ТОЛЬКО
чтобы понять короткие уточнения-продолжения (вроде «сделай короче», «а для рилса?»,
«ещё вариант»). Приветствие, благодарность или болтовня — это ВСЕГДА chat, даже если
до этого обсуждали сценарий.
Ответь РОВНО одним словом из списка, без пояснений и знаков препинания:

- chat — приветствие, болтовня, благодарность, мета-вопрос о тебе, короткое уточнение без новой темы.
- short — просьба придумать/написать сценарий, хук, идею, превью или название для КОРОТКОГО видео (рилс, reels, шортс, shorts, tiktok, тикток, клип, ВИСП).
- long — просьба про сценарий/структуру/хук/удержание ДЛИННОГО видео (YouTube 5+ минут, ролик, лонг, выпуск).
- method — вопрос по методике/теории без генерации артефакта (удержание, темы, превью, монтаж, SEO, продвижение, как работает YouTube).

Формат ответа: «<категория> | <3–5 ключевых слов по теме для поиска, через пробел>».
Ключевые слова — на русском: термины и синонимы темы (для short/long/method), чтобы
найти нужное в базе. Для chat ключевые слова не нужны — ответь просто «chat |».
Примеры: «long | удержание зрителя вовлечение первые секунды хук», «chat |».`;

function mapCategory(category: QueryCategory): RouteDecision {
  const base: RouteDecision = {
    category,
    formats: false,
    tgClosed: false,
    tgOpen: false,
    book: false,
    searchQuery: "",
  };
  switch (category) {
    case "short":
      // Короткие видео: подходящий формат + закрытый TG (ВИСП, рилсы, шортсы).
      return { ...base, formats: true, tgClosed: true };
    case "long":
    case "method":
      // Длинные сценарии и методика: релевантные куски книги (поиск).
      return { ...base, book: true };
    case "chat":
    default:
      // Болтовня: только хребет, ничего не подгружаем.
      return { ...base, category: "chat" };
  }
}

/** Грубая keyword-эвристика на случай ошибки LLM-роутера. */
function heuristicCategory(text: string): QueryCategory {
  const t = text.toLowerCase();
  const isShort = /(рилс|reels|шортс|shorts|tiktok|тикток|висп|клип)/.test(t);
  const wantsGen = /(сценари|напиши|придума|сделай|хук|заход|идею|идей|сними|превью|назван)/.test(t);
  if (isShort) return "short";
  if (wantsGen && /(ролик|видео|лонг|выпуск|youtube|ютуб|канал)/.test(t)) return "long";
  if (wantsGen) return "long";
  if (/(как|почему|что такое|зачем|удержани|монтаж|seo|продвиж|тег|алгоритм)/.test(t)) return "method";
  return "chat";
}

const VALID: QueryCategory[] = ["chat", "short", "long", "method"];

const GEN_RE =
  /(сценари|напиши|придума|сделай|хук|заход|идею|идей|превью|назван|рилс|шортс|reels|shorts|tiktok|тикток|клип|висп|ролик|видео|выпуск|лонг)/;
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
 * Классифицировать запрос и вернуть, какие слои грузить. messages — последние
 * сообщения диалога (для контекста follow-up вроде «сделай короче»).
 */
export async function routeQuery(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<RouteDecision> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // Очевидная болтовня — сразу chat, без вызова LLM-роутера.
  if (isObviousChat(lastUser)) return mapCategory("chat");
  // Правка предыдущего результата — не перезагружаем слои (исходник в истории,
  // она в кэше). category "long" → thinking остаётся включён, но book=false.
  if (isEditFollowup(lastUser, messages)) {
    const d = mapCategory("long");
    d.book = false;
    d.searchQuery = lastUser;
    return d;
  }
  // Контекст: последние до 4 реплик, чтобы понять follow-up.
  const ctx = messages.slice(-4);
  try {
    const resp = await getAnthropic().messages.create({
      model: ROUTER_MODEL,
      max_tokens: 40,
      system: ROUTER_SYSTEM,
      messages: ctx.map((m) => ({ role: m.role, content: m.content })),
    });
    const raw = resp.content.find((b) => b.type === "text");
    const out = raw && raw.type === "text" ? raw.text : "";
    const [catPart, ...kw] = out.split("|");
    const word = catPart.toLowerCase().trim().replace(/[^a-z]/g, "");
    const keywords = kw.join("|").trim();
    const category = (VALID.includes(word as QueryCategory)
      ? word
      : heuristicCategory(lastUser)) as QueryCategory;
    const decision = mapCategory(category);
    // Поисковый запрос = ключевые слова от роутера + сам вопрос (расширение recall).
    decision.searchQuery = `${keywords} ${lastUser}`.trim();
    return decision;
  } catch {
    const decision = mapCategory(heuristicCategory(lastUser));
    decision.searchQuery = lastUser;
    return decision;
  }
}
