// ── Подбор ключевых слов: чистый модуль (клиент/сервер) ──────────────────────
//
// Инструмент того же класса, что keyword research у vidIQ, но на честных данных:
// подсказки поиска YouTube (что люди дописывают) + число роликов по запросу
// (конкуренция) + медиана просмотров тех, кто уже в топе (живая ниша или мёртвая).
//
// ⚠️⚠️ ОБЪЁМА ПОИСКА У НАС НЕТ И НЕ БУДЕТ: сколько раз в месяц ищут запрос,
// YouTube не сообщает никому — «search volume» у vidIQ это ИХ ОЦЕНКА по своей
// модели, а не цифра от YouTube. Поэтому мы её не показываем и не выдумываем:
// спрос отражает порядок подсказок (что YouTube предлагает первым), а «есть ли
// там зритель» — медиана просмотров топа. Во внутреннем курсе шеф-редакторов
// студии порог «объёма ~2000» относится именно к цифре ВНУТРИ vidIQ; подставлять
// под неё свои числа нельзя — это будет другая шкала с тем же названием.
//
// ⚠️ Пороги ниже — НАШИ рабочие, а не из методики. Помечено намеренно: в базе
// знаний норм по конкуренции нет, и выдавать свои за методику Велижанина нельзя.

export interface KeywordStats {
  query: string;
  /** Сколько всего роликов YouTube нашёл по запросу. */
  totalResults: number;
  /** Медиана просмотров у роликов первой страницы выдачи. */
  medianViews: number;
  /** Кто сейчас держит верх выдачи (для «а туда вообще можно влезть»). */
  top: { id: string; title: string; channelTitle: string; views: number }[];
}

export type CompetitionLevel = "free" | "medium" | "crowded";
export type DemandLevel = "dead" | "warm" | "hot";

export interface KeywordVerdict {
  competition: CompetitionLevel;
  demand: DemandLevel;
  /** Короткий вывод в голосе продукта: брать / брать с оговоркой / не лезть. */
  verdict: "take" | "maybe" | "skip";
  hint: string;
}

// Границы конкуренции (число роликов по запросу). Наши, подобраны по живым
// прогонам русской выдачи: «ремонт квартиры» — 6,4 млн, узкие нишевые фразы —
// десятки тысяч.
const COMPETITION_MEDIUM = 100_000;
const COMPETITION_CROWDED = 1_000_000;

// Границы спроса по медиане просмотров топа. Если верх выдачи живёт на 500
// просмотрах — запрос никто не ищет, сколько бы роликов по нему ни лежало.
const DEMAND_WARM = 10_000;
const DEMAND_HOT = 100_000;

export function competitionLevel(totalResults: number): CompetitionLevel {
  if (totalResults >= COMPETITION_CROWDED) return "crowded";
  if (totalResults >= COMPETITION_MEDIUM) return "medium";
  return "free";
}

export function demandLevel(medianViews: number): DemandLevel {
  if (medianViews >= DEMAND_HOT) return "hot";
  if (medianViews >= DEMAND_WARM) return "warm";
  return "dead";
}

/**
 * Насколько ШИРОКИЙ ключ — то есть сколько всего роликов им уже описано.
 *
 * ⚠️ Это не то же самое, что конкуренция, хотя цифра одна: конкуренция отвечает на
 * «пробьюсь ли я», охват — на «про то ли я вообще говорю». В тегах ролика по методике
 * нужны и широкие (чтобы попасть в тему), и узкие (чтобы попасть в свой запрос), —
 * поэтому подпись отдельная.
 */
export function reachLabel(totalResults: number): string {
  if (totalResults >= 5_000_000) return "очень широкий";
  if (totalResults >= 1_000_000) return "широкий";
  if (totalResults >= 100_000) return "средний";
  if (totalResults >= 10_000) return "узкий";
  return "совсем узкий";
}

export const COMPETITION_LABEL: Record<CompetitionLevel, string> = {
  free: "свободно",
  medium: "средне",
  crowded: "плотно",
};

export const DEMAND_LABEL: Record<DemandLevel, string> = {
  dead: "спроса почти нет",
  warm: "спрос есть",
  hot: "горячий спрос",
};

/**
 * Вердикт по ключу. Логика простая и объяснимая (а не «score 68/100», по которому
 * непонятно, что делать): смотрим, есть ли зритель, и насколько плотно занято.
 */
export function keywordVerdict(s: KeywordStats): KeywordVerdict {
  const competition = competitionLevel(s.totalResults);
  const demand = demandLevel(s.medianViews);

  if (demand === "dead") {
    return {
      competition,
      demand,
      verdict: "skip",
      hint: "В топе по этому запросу почти не смотрят — тема людям не нужна или её ищут другими словами.",
    };
  }
  if (competition === "crowded" && demand !== "hot") {
    return {
      competition,
      demand,
      verdict: "maybe",
      hint: "Занято плотно, а спрос средний: заходить только с сильной упаковкой или своим углом.",
    };
  }
  if (competition === "free") {
    return {
      competition,
      demand,
      verdict: "take",
      hint: "Смотрят, а роликов мало — это и есть щель, куда стоит зайти.",
    };
  }
  return {
    competition,
    demand,
    verdict: demand === "hot" ? "take" : "maybe",
    hint:
      demand === "hot"
        ? "Спрос горячий, конкуренция терпимая — берём, вопрос только в упаковке."
        : "Рабочий средний запрос: пойдёт как тема, но чуда от него не жди.",
  };
}

export const VERDICT_LABEL: Record<KeywordVerdict["verdict"], string> = {
  take: "брать",
  maybe: "можно",
  skip: "мимо",
};

export const VERDICT_COLOR: Record<KeywordVerdict["verdict"], string> = {
  take: "teal",
  maybe: "brand",
  skip: "gray",
};

/** Медиана (для просмотров топа). Пустой список — 0. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Сколько фраз максимум оцениваем за раз: каждая — отдельная страница выдачи. */
export const MAX_STATS_QUERIES = 6;
/** Сколько подсказок отдаём на экран. */
export const MAX_SUGGESTIONS = 24;

/**
 * Банк тегов из набора роликов: что чаще всего ставят в нише.
 *
 * ⚠️ Сортируем по ЧИСЛУ роликов, где тег встретился, а не по суммарным просмотрам:
 * один залетевший ролик иначе протащит наверх свои случайные теги.
 */
export function aggregateTags(
  videos: { tags: string[] }[],
  limit = 30
): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const v of videos) {
    // Внутри одного ролика тег считаем один раз.
    const seen = new Set<string>();
    for (const raw of v.tags) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
