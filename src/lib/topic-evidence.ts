// ── Проверка темы реальной выдачей YouTube ───────────────────────────────────
//
// ⚠️ Зачем: без этого любая тема — мнение модели. С этим она превращается в
// решение с доказательством: «по этой теме в нише ролик собрал 300 тысяч при 20
// тысячах подписчиков» или «по ней не снимает никто — ниша свободна». Ровно этого
// нет ни у vidIQ (он не генерирует темы), ни у чат-ботов (у них нет живой выдачи).
//
// ⚠️ Стоит 0 units: и подсказки, и страница выдачи идут мимо Data API
// (см. youtube-scrape.ts). Поэтому проверять можно каждую тему, а не выборочно.

import { fetchSearchStats } from "./youtube-scrape";
import { median } from "./keywords";

export interface TopicEvidence {
  topic: string;
  /** Сколько роликов уже снято по этой теме — плотность. */
  totalResults: number;
  /** Медиана просмотров у тех, кто в топе: есть ли там зритель вообще. */
  medianViews: number;
  /** Самый успешный ролик из топа — им и доказываем. */
  best: { title: string; channelTitle: string; views: number } | null;
  /** Короткий человеческий вывод: брать тему или нет. */
  verdict: string;
}

/** Сколько тем проверяем за раз: каждая — отдельная страница выдачи. */
export const MAX_TOPICS = 8;

export interface TopicCheckResult {
  evidence: TopicEvidence[];
  /**
   * Сколько тем проверить НЕ УДАЛОСЬ (сбой чтения выдачи), в отличие от «по теме
   * пусто».
   *
   * ⚠️⚠️ Различение обязательно, ловили на проде: сервис скрейпа моргнул, все
   * темы вернули null, и панель показала «людям такое почти не ищут» про
   * «Города-призраки России» — заведомо живую тему. Сбой, выдающий себя за
   * инсайт о нише, хуже честной ошибки: по нему человек выкидывает рабочие темы.
   */
  failed: number;
}

/**
 * Проверить темы по выдаче.
 *
 * ⚠️ Тему проверяем как ПОИСКОВЫЙ запрос, а не как название ролика: длинное
 * кликбейтное название («Ты ешь их каждый день. Что вызывает рак прямо из твоей
 * тарелки?») в поиске не ищет никто, и выдача по нему будет пустой — что не значит
 * «ниша свободна». Поэтому из названия достаём суть: первые значимые слова.
 */
export async function checkTopics(topics: string[]): Promise<TopicCheckResult> {
  const list = topics.slice(0, MAX_TOPICS).filter((t) => t.trim().length > 0);
  if (list.length === 0) return { evidence: [], failed: 0 };

  let failed = 0;
  const checked = await Promise.all(
    list.map(async (topic): Promise<TopicEvidence | null> => {
      const query = searchableQuery(topic);
      if (!query) return null;

      const res = await fetchSearchStats(query).catch(() => null);
      if (!res) {
        // ⚠️ null у fetchSearchStats — это «не смог прочитать выдачу» (сервис,
        // таймаут, сменилась разметка), а НЕ «по теме пусто»: на живой запрос
        // YouTube всегда отдаёт хоть что-то похожее.
        failed += 1;
        console.warn("[topics] не удалось прочитать выдачу по теме:", query);
        return null;
      }

      const views = res.top.map((v) => v.views).filter((v) => v > 0);
      const med = median(views);
      const best = res.top.reduce<TopicEvidence["best"]>((acc, v) => {
        if (!acc || v.views > acc.views) {
          return { title: v.title, channelTitle: v.channelTitle, views: v.views };
        }
        return acc;
      }, null);

      return {
        topic,
        totalResults: res.totalResults,
        medianViews: med,
        best,
        verdict: verdictFor(res.totalResults, med),
      };
    })
  );

  return { evidence: checked.filter((x): x is TopicEvidence => x !== null), failed };
}

/**
 * Из названия ролика — поисковый запрос.
 *
 * ⚠️ Отбрасываем «оболочку» кликбейта (местоимения, вводные, вопросительные
 * слова): в поиске люди набирают суть, а не заголовок целиком.
 */
export function searchableQuery(topic: string): string {
  const stop = new Set([
    "как", "что", "почему", "зачем", "когда", "где", "если", "это", "эти", "этот",
    "твой", "твоя", "твои", "мой", "моя", "вас", "вам", "тебя", "себя", "они", "она",
    "который", "которые", "просто", "самый", "самая", "самые", "очень", "каждый",
    "прямо", "нужно", "надо", "может", "быть", "есть",
    // Короткие служебные: порог длины опущен до двух символов ради значимых
    // аббревиатур («ЖК», «ИП», «БУ»), поэтому предлоги надо отсекать явно.
    "не", "ни", "но", "да", "же", "ли", "бы", "во", "со", "об", "от", "до", "за",
    "из", "по", "на", "в", "с", "к", "у", "о", "и", "а",
  ]);
  const words = topic
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/g, " ")
    .split(/\s+/)
    // ⚠️ Порог 2, а не 3: иначе теряются аббревиатуры вроде «ЖК» — а это ровно то
    // слово, по которому тему и ищут (ловили на «Как выбрать ЖК в Казани»).
    .filter((w) => w.length >= 2 && !stop.has(w));
  return words.slice(0, 4).join(" ");
}

function verdictFor(totalResults: number, medianViews: number): string {
  if (medianViews === 0) {
    return "в выдаче почти не смотрят — либо тему ищут другими словами, либо она никому не нужна";
  }
  if (totalResults < 100_000 && medianViews >= 50_000) {
    return "щель: смотрят охотно, а роликов мало — брать";
  }
  if (medianViews >= 200_000) {
    return "тема горячая, но и занято плотно — заходить только с сильной упаковкой";
  }
  if (medianViews < 5_000) {
    return "спрос слабый — как основную тему не брать, максимум как шортс";
  }
  return "рабочая тема со спросом, вопрос в упаковке";
}

/** Блок доказательств для промпта: модель приложит цифры к своим темам. */
export function evidencePromptBlock(items: TopicEvidence[]): string {
  if (items.length === 0) return "";
  const lines: string[] = [
    "# ЧТО ПО ЭТИМ ТЕМАМ УЖЕ ЕСТЬ В ВЫДАЧЕ YOUTUBE",
    "Живые цифры, только что снятые с поиска. Приложи их к темам: человеку нужно решение с доказательством, а не мнение. Если по теме пусто — так и скажи, это тоже сигнал.",
  ];
  for (const e of items) {
    const best = e.best
      ? ` Лучший в топе: «${e.best.title}» — ${e.best.views.toLocaleString("ru-RU")} просмотров (${e.best.channelTitle}).`
      : "";
    lines.push(
      "",
      `- ${e.topic}: роликов по теме ${e.totalResults.toLocaleString("ru-RU")}, медиана просмотров в топе ${e.medianViews.toLocaleString("ru-RU")}. ${e.verdict}.${best}`
    );
  }
  return lines.join("\n");
}
