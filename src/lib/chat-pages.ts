// ── Изучение сайтов по ходу разговора ────────────────────────────────────────
//
// ⚠️ Главный вход — ЧАТ, а не настройки проекта: человек кидает ссылку и говорит
// «изучи», а не идёт заполнять карточку заранее. Поэтому здесь две вещи сразу:
//   1) страница читается и уходит в промпт ТЕКУЩЕГО ответа целиком;
//   2) она же ЗАПОМИНАЕТСЯ в проекте, чтобы в следующих сообщениях оставаться в
//      контексте — иначе через два вопроса ассистент снова про неё не знает.
//
// ⚠️ Разбор моделью (digest) здесь НЕ делается: это второй вызов LLM и лишняя
// квота, а человек просто спросил. Сохраняем текст, а разобрать подробно можно
// потом — при сборке профиля проекта или по кнопке в настройках. Так контекст
// «дорабатывается» со временем, а первый ответ не ждёт лишнюю минуту.

import { prisma } from "./prisma";
import { fetchPage, pagePromptBlock } from "./web-fetch";
import { MAX_SOURCES } from "./project-profile";

/** Сколько текста сохранённой страницы уходит в контекст следующих сообщений. */
const REMEMBERED_TEXT_LIMIT = 1500;

export interface StudiedPage {
  url: string;
  title: string;
  ok: boolean;
}

/**
 * Прочитать страницы и собрать блок для промпта.
 *
 * ⚠️ Неудачу НЕ замалчиваем: если сайт не открылся, модель должна сказать об этом
 * прямо, а не разбирать пустоту (тот же принцип, что с расшифровками роликов).
 */
export async function buildPagesBlock(
  conversationId: string,
  urls: string[]
): Promise<{ block: string; pages: StudiedPage[] }> {
  if (urls.length === 0) return { block: "", pages: [] };

  const results = await Promise.all(
    urls.map(async (url) => {
      const res = await fetchPage(url).catch(() => null);
      return { url, res };
    })
  );

  const parts: string[] = [];
  const pages: StudiedPage[] = [];

  for (const { url, res } of results) {
    if (!res || res.status === "error") {
      const reason = res && res.status === "error" ? res.reason : "страница не открылась";
      parts.push(
        `Страница ${url}: открыть не удалось (${reason}). Скажи об этом ПРЯМО и попроси прислать текст или скриншот. Содержимое НЕ придумывай.`
      );
      pages.push({ url, title: "", ok: false });
      continue;
    }
    if (res.status === "empty") {
      parts.push(
        `Страница ${url}: открылась, но текста в ней нет — содержимое подгружается скриптами. Скажи об этом честно и попроси прислать текст или ссылку на версию попроще.`
      );
      pages.push({ url, title: "", ok: false });
      continue;
    }

    parts.push(pagePromptBlock(res.page));
    pages.push({ url: res.page.url, title: res.page.title, ok: true });
    // Запоминаем в проекте — fire-and-forget: ответ важнее записи.
    void rememberSource(conversationId, res.page.url, res.page.title, res.page.text);
  }

  const block = [
    "# СТРАНИЦЫ, КОТОРЫЕ ЧЕЛОВЕК ДАЛ ИЗУЧИТЬ",
    "Разбирай по этому тексту, а не по догадкам: тут офферы, характеристики, цены и формулировки клиента. Когда делаешь темы, сценарии, продающий контент или выгоды — бери фактуру отсюда. Чего на странице нет — не выдумывай.",
    "",
    parts.join("\n\n---\n\n"),
  ].join("\n");

  return { block, pages };
}

/**
 * Запомнить страницу как источник проекта.
 *
 * ⚠️ Upsert по паре (проект, адрес): человек скидывает одну и ту же ссылку по
 * десять раз, и плодить дубли незачем — обновляем текст.
 * ⚠️ Потолок MAX_SOURCES: старые вытесняем, иначе через месяц работы блок
 * источников вытеснит из промпта саму методику.
 */
async function rememberSource(
  conversationId: string,
  url: string,
  title: string,
  text: string
): Promise<void> {
  try {
    const existing = await prisma.projectSource.findFirst({
      where: { conversationId, url },
      select: { id: true },
    });

    if (existing) {
      await prisma.projectSource.update({
        where: { id: existing.id },
        data: { text: text.slice(0, 20000), title: title.slice(0, 120) || url },
      });
      return;
    }

    await prisma.projectSource.create({
      data: {
        conversationId,
        url,
        title: title.slice(0, 120) || new URL(url).hostname,
        kind: "site",
        text: text.slice(0, 20000),
      },
    });

    // Вытесняем самые старые, если их стало больше потолка.
    const all = await prisma.projectSource.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (all.length > MAX_SOURCES) {
      await prisma.projectSource.deleteMany({
        where: { id: { in: all.slice(MAX_SOURCES).map((r) => r.id) } },
      });
    }
  } catch (err) {
    console.error("[chat-pages] запись источника:", err);
  }
}

/**
 * Короткая выжимка запомненных страниц для следующих сообщений.
 *
 * ⚠️ Здесь СОКРАЩЁННЫЙ текст, а не полный: страница уже была разобрана в том
 * ответе, где её прислали, и таскать её целиком в каждом последующем запросе —
 * значит вытеснить из контекста методику. Разобранные источники (с digest)
 * показываются отдельным блоком — см. buildSourcesBlock.
 */
export function rememberedPagesBlock(
  sources: { title: string; url: string; text: string; hasDigest: boolean }[]
): string {
  const plain = sources.filter((s) => !s.hasDigest && s.text.trim().length > 0);
  if (plain.length === 0) return "";

  const lines: string[] = [
    "# СТРАНИЦЫ, ИЗУЧЕННЫЕ РАНЕЕ В ЭТОМ ПРОЕКТЕ",
    "Их присылали в предыдущих сообщениях. Держи в уме; если человек ссылается на них («тот сайт», «этот ЖК») — работай с этой фактурой. Нужны подробности, которых тут нет, — попроси прислать ссылку ещё раз.",
  ];
  for (const s of plain) {
    lines.push("", `## ${s.title} — ${s.url}`, s.text.slice(0, REMEMBERED_TEXT_LIMIT));
  }
  return lines.join("\n");
}
