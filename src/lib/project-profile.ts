// ── Профиль проекта: чистый модуль (клиент/сервер) ───────────────────────────
//
// ⚠️⚠️ ЗАЧЕМ ЭТО ВООБЩЕ. Раньше в промпт уходили ответы анкеты как есть — восемь
// коротких строк, около 340 символов на весь контекст. Всё остальное (кто клиент,
// чего боится, чем этот эксперт отличается от соседа, какими словами говорит ниша)
// модель достраивала САМА, на каждом запросе заново, из своего дефолтного
// распределения. Отсюда и «средние по интернету» идеи: не промпт плохой, а фактуры
// нет.
//
// Профиль — это РАЗОВЫЙ дорогой разбор: бриф + данные канала + изученные страницы
// клиента превращаются в выводы, которые дальше подставляются во ВСЕ генерации.
// Заплатили один раз при создании проекта, пользуемся всегда.
//
// ⚠️ Профиль НЕ заменяет бриф в базе: бриф остаётся сырьём и источником правды
// (его правит человек), профиль — производная, которую можно пересобрать заново.

export interface AudienceSegment {
  /** Короткое имя сегмента, которым его называют в работе. */
  name: string;
  /** Кто это: возраст, роль, ситуация, в какой момент приходит. */
  who: string;
  /** Боли ОТ ПЕРВОГО ЛИЦА — так, как человек сам это произносит. */
  pains: string[];
  /** Возражения: почему НЕ купит / не досмотрит / не поверит. */
  objections: string[];
  /** Что цепляет: триггеры, на которые этот сегмент реагирует. */
  triggers: string[];
}

export interface ProjectProfile {
  /** Позиционирование одной фразой: кто это и чем отличается от соседа по нише. */
  positioning: string;
  /** Чем реально отличается — три-пять пунктов, а не общие слова. */
  differentiators: string[];
  /** Сегменты аудитории с болями и возражениями. */
  segments: AudienceSegment[];
  /** Лексика ниши: как об этом говорят САМИ клиенты (не отраслевой жаргон). */
  vocabulary: string[];
  /** Что продаёт и на чём зарабатывает — продуктовая линейка словами. */
  products: string[];
  /** Гипотезы заходов: на чём строить хуки именно у этого проекта. */
  hookAngles: string[];
  /** Форматы и подача под тип харизмы спикера. */
  formats: string[];
  /** Тон и запреты: чего в кадре быть не должно. */
  tone: string;
  /**
   * Чего мы про проект НЕ знаем.
   *
   * ⚠️ Обязательное поле, и оно важнее, чем кажется: без него модель заполняет
   * пробелы правдоподобной выдумкой (тот самый класс ошибок, что «болячки мотора
   * M274»). Явный список незнания — приглашение спросить, а не додумать.
   */
  unknowns: string[];
}

/** Разбор одной изученной страницы. */
export interface SourceDigest {
  /** Что это за штука одной фразой. */
  summary: string;
  /** Оффер: что предлагают и на каких условиях. */
  offer: string;
  /** Характеристики как они написаны на странице. */
  features: string[];
  /** Те же характеристики, переведённые в человеческую выгоду. */
  benefits: string[];
  /** Возражения, которые страница снимает (или наоборот — оставляет). */
  objections: string[];
  /** Цены и условия, если указаны. Пусто — значит на странице их нет. */
  pricing: string[];
  /** Кому это подходит по версии самой страницы. */
  audience: string[];
}

export const SOURCE_KINDS = ["site", "product", "article", "competitor"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  site: "Сайт",
  product: "Продукт / объект",
  article: "Статья",
  competitor: "Конкурент",
};

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === "string" && (SOURCE_KINDS as readonly string[]).includes(v);
}

/** Стоимость в запросах квоты. Цифры наши, не из методики. */
export const PROFILE_QUOTA_COST = 2; // разбор проекта целиком
export const SOURCE_QUOTA_COST = 1; // разбор одной страницы

/** Сколько источников максимум держим в проекте (и подставляем в промпт). */
export const MAX_SOURCES = 20;

function clean(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanList(v: unknown, limit: number, max = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clean(x, max))
    .filter(Boolean)
    .slice(0, limit);
}

/** Нормализация ответа модели: лишнее режем, форму гарантируем. */
export function sanitizeProfile(raw: unknown): ProjectProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const segments = Array.isArray(o.segments)
    ? o.segments.slice(0, 5).flatMap((x): AudienceSegment[] => {
        if (!x || typeof x !== "object") return [];
        const s = x as Record<string, unknown>;
        const name = clean(s.name, 80);
        if (!name) return [];
        return [
          {
            name,
            who: clean(s.who, 300),
            pains: cleanList(s.pains, 6),
            objections: cleanList(s.objections, 6),
            triggers: cleanList(s.triggers, 6),
          },
        ];
      })
    : [];

  const profile: ProjectProfile = {
    positioning: clean(o.positioning, 400),
    differentiators: cleanList(o.differentiators, 6),
    segments,
    vocabulary: cleanList(o.vocabulary, 30, 60),
    products: cleanList(o.products, 8),
    hookAngles: cleanList(o.hookAngles, 8),
    formats: cleanList(o.formats, 6),
    tone: clean(o.tone, 400),
    unknowns: cleanList(o.unknowns, 8),
  };

  // Пустой профиль не нужен: лучше его отсутствие, чем блок-заглушка в промпте.
  const filled =
    profile.positioning || profile.segments.length > 0 || profile.differentiators.length > 0;
  return filled ? profile : null;
}

export function sanitizeDigest(raw: unknown): SourceDigest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const digest: SourceDigest = {
    summary: clean(o.summary, 400),
    offer: clean(o.offer, 400),
    features: cleanList(o.features, 20),
    benefits: cleanList(o.benefits, 20),
    objections: cleanList(o.objections, 12),
    pricing: cleanList(o.pricing, 8),
    audience: cleanList(o.audience, 8),
  };
  return digest.summary || digest.offer || digest.features.length ? digest : null;
}

/**
 * Профиль в промпт.
 *
 * ⚠️ Идёт ВМЕСТО сырых полей брифа (не вместе): дублировать одно и то же дважды —
 * значит тратить контекст и путать модель. Бриф остаётся в базе как источник
 * правды и как то, что правит человек.
 */
export function buildProfileBlock(p: ProjectProfile | null | undefined): string {
  if (!p) return "";
  const lines: string[] = ["# ПРОФИЛЬ ПРОЕКТА (разобран по брифу, каналу и материалам клиента)"];

  if (p.positioning) lines.push("", `Позиционирование: ${p.positioning}`);
  if (p.differentiators.length) {
    lines.push("", "Чем отличается от других в нише:");
    for (const d of p.differentiators) lines.push(`- ${d}`);
  }
  if (p.products.length) {
    lines.push("", `Что продаёт: ${p.products.join(" · ")}`);
  }

  if (p.segments.length) {
    lines.push("", "Сегменты аудитории:");
    for (const s of p.segments) {
      lines.push(`- ${s.name}${s.who ? ` — ${s.who}` : ""}`);
      if (s.pains.length) lines.push(`  боли от 1 лица: ${s.pains.join(" | ")}`);
      if (s.objections.length) lines.push(`  возражения: ${s.objections.join(" | ")}`);
      if (s.triggers.length) lines.push(`  цепляет: ${s.triggers.join(" | ")}`);
    }
  }

  if (p.vocabulary.length) {
    lines.push(
      "",
      `Лексика ниши (так говорят САМИ клиенты — пиши этими словами, а не отраслевым жаргоном): ${p.vocabulary.join(", ")}`
    );
  }
  if (p.hookAngles.length) {
    lines.push("", "Рабочие заходы под этот проект:");
    for (const h of p.hookAngles) lines.push(`- ${h}`);
  }
  if (p.formats.length) lines.push("", `Форматы под спикера: ${p.formats.join(" · ")}`);
  if (p.tone) lines.push("", `Тон и запреты: ${p.tone}`);

  if (p.unknowns.length) {
    // ⚠️ Самая полезная часть блока: явное «чего мы не знаем» гасит соблазн
    // додумать. Согласовано с Антипаттерном №9 и FACTS_CHECK.
    lines.push(
      "",
      "Чего мы про проект НЕ знаем (не выдумывай — если нужно для артефакта, спроси ОДНИМ конкретным вопросом):"
    );
    for (const u of p.unknowns) lines.push(`- ${u}`);
  }

  return lines.join("\n");
}

/** Блок изученных источников для промпта. */
export function buildSourcesBlock(
  sources: { title: string; kind: string; url: string; digest: SourceDigest | null }[]
): string {
  const withDigest = sources.filter((s) => s.digest);
  if (withDigest.length === 0) return "";

  const lines: string[] = [
    "# МАТЕРИАЛЫ КЛИЕНТА (страницы, которые он дал изучить)",
    "Это фактура из первых рук: офферы, характеристики, цены, формулировки. Когда делаешь продающий ролик, нативное закрытие или разбираешь выгоды — бери отсюда, а не придумывай. Если человек называет объект по имени («сделай под ЖК Северный») — работай с соответствующим материалом.",
  ];

  for (const s of withDigest.slice(0, MAX_SOURCES)) {
    const d = s.digest as SourceDigest;
    lines.push("", `## ${s.title} (${SOURCE_KIND_LABEL[s.kind as SourceKind] ?? s.kind})`);
    if (d.summary) lines.push(d.summary);
    if (d.offer) lines.push(`Оффер: ${d.offer}`);
    if (d.pricing.length) lines.push(`Цены и условия: ${d.pricing.join(" · ")}`);
    if (d.audience.length) lines.push(`Кому подходит: ${d.audience.join(" · ")}`);
    if (d.benefits.length) {
      lines.push(`Выгоды человеческим языком: ${d.benefits.slice(0, 12).join(" | ")}`);
    }
    if (d.features.length) {
      lines.push(`Характеристики как на странице: ${d.features.slice(0, 12).join(" · ")}`);
    }
    if (d.objections.length) lines.push(`Возражения: ${d.objections.join(" | ")}`);
  }

  return lines.join("\n");
}
