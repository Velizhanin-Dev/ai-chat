import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { assertOwnedProject } from "@/lib/youtube";
import { sanitizeFilters, sanitizeQueries } from "@/lib/competitors";
import {
  getCompetitorContext,
  runCompetitorSearch,
  loadMoreCompetitors,
  findNicheChannels,
  addTrackedChannel,
  removeTrackedChannel,
  listTrackedChannels,
  loadTrackedFeed,
  clearTrackedFeedCache,
  normalizeOrder,
  normalizePeriod,
} from "@/lib/competitors-server";

export const dynamic = "force-dynamic";

// Разделы «Конкуренты» и «Поиск референсов» открыты всем залогиненным (раньше были
// админскими). Гейт — сессия + владение проектом.
//
// ⚠️ Поиск остаётся дорогим (100 units за запрос против 1 у остальных вызовов), но
// цену человеку не показываем: он видит рабочую функцию, а состояние пула ключей
// живёт в админке (/admin/flags → «Квота поиска YouTube»).
//
// GET  ?projectId= — контекст: подсказки запросов, состояние пула ключей.
// POST { projectId, queries, periodDays, order, mode } — поиск (`mode: "search"`,
// первая страница) или догрузка следующей страницы (`mode: "more"`). Кэшем управляет
// сервер: те же параметры в пределах TTL отдаются из памяти, изменённые — ищутся заново.

async function guard(projectId: string) {
  const user = await getSessionUser();
  if (!user) return null;
  return assertOwnedProject(user.id, projectId);
}

// Свой список конкурентов (добавленные руками каналы) — отдельные методы, потому
// что он живёт в БД и от поиска роликов не зависит.
export async function PUT(req: Request) {
  const body = (await readJson(req)) ?? {};
  const owned = await guard(String(body.projectId ?? ""));
  if (!owned) return apiError("Не найдено", 404);

  const input = String(body.input ?? "").trim().slice(0, 300);
  if (!input) return apiError("Вставьте ссылку на канал, @хэндл или его id");

  const out = await addTrackedChannel(owned, input);
  if (out.status === "not_found")
    return apiError("Канал не найден — проверьте ссылку или @хэндл", 404);
  if (out.status === "no_keys")
    return apiError("Поиск по YouTube не настроен — обратитесь к администратору", 503, "YT_NO_KEYS");
  if (out.status === "quota")
    return apiError(
      "Лимит запросов к YouTube на сегодня исчерпан — обновится ночью",
      429,
      "YT_QUOTA"
    );
  if (out.status === "error") return apiError(out.message, 502);
  // Состав списка изменился — лента, посчитанная по старому составу, устарела.
  clearTrackedFeedCache(owned);
  return NextResponse.json({ channel: out.channel });
}

// Включить/выключить уведомления «у конкурента залетел ролик» для проекта.
export async function PATCH(req: Request) {
  const body = (await readJson(req)) ?? {};
  const owned = await guard(String(body.projectId ?? ""));
  if (!owned) return apiError("Не найдено", 404);

  const alerts = Boolean(body.alerts);
  await prisma.conversation.update({
    where: { id: owned },
    data: { competitorAlerts: alerts },
  });
  return NextResponse.json({ alerts });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const owned = await guard(url.searchParams.get("projectId") ?? "");
  if (!owned) return apiError("Не найдено", 404);
  const ok = await removeTrackedChannel(owned, url.searchParams.get("id") ?? "");
  if (!ok) return apiError("Канал не найден", 404);
  clearTrackedFeedCache(owned);
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const owned = await guard(projectId);
  if (!owned) return apiError("Не найдено", 404);

  const sp = new URL(req.url).searchParams;
  // ?tracked=1 — только свой список конкурентов (без контекста и подсказок).
  if (sp.get("tracked")) {
    return NextResponse.json({ channels: await listTrackedChannels(owned) });
  }
  // ?feed=1 — лента новых роликов отслеживаемых каналов (поиск не запускает,
  // стоит ~2 units на канал; ?refresh=1 — мимо получасового кэша).
  if (sp.get("feed")) {
    const days = Number(sp.get("days")) === 30 || Number(sp.get("days")) === 90
      ? Number(sp.get("days"))
      : 7;
    const out = await loadTrackedFeed(owned, days, sp.get("refresh") === "1");
    if (out.status === "empty")
      return NextResponse.json({ result: null, empty: true });
    if (out.status === "no_keys")
      return apiError("Поиск по YouTube не настроен — обратитесь к администратору", 503, "YT_NO_KEYS");
    if (out.status === "quota")
      return apiError(
      "Лимит запросов к YouTube на сегодня исчерпан — обновится ночью",
      429,
      "YT_QUOTA"
    );
    if (out.status === "error") return apiError(out.message, 502);
    return NextResponse.json({ result: out.result, cached: out.cached, empty: false });
  }
  return NextResponse.json(await getCompetitorContext(owned));
}

export async function POST(req: Request) {
  const body = (await readJson(req)) ?? {};
  const owned = await guard(String(body.projectId ?? ""));
  if (!owned) return apiError("Не найдено", 404);

  const queries = sanitizeQueries(body.queries);
  if (queries.length === 0) return apiError("Добавьте хотя бы один запрос", 400);

  const args = {
    queries,
    periodDays: normalizePeriod(body.periodDays),
    order: normalizeOrder(body.order),
    // Фильтры экрана приезжают с клиента: по ним сервер понимает, набралось ли уже
    // COMPETITOR_TARGET_RESULTS подходящих роликов, или надо листать дальше. Сама
    // фильтрация выдачи по-прежнему клиентская (крутить ручки бесплатно).
    filters: sanitizeFilters(body.filters),
  };
  // mode: "channels" — конкуренты-КАНАЛЫ поверх уже найденной выдачи (своего
  // поиска не запускает; нет кэша → expired, чтобы человек нажал «Найти» сам).
  const out =
    body.mode === "channels"
      ? await findNicheChannels(owned, args)
      : body.mode === "more"
        ? await loadMoreCompetitors(owned, args)
        : await runCompetitorSearch(owned, args);

  // Продолжать можно только от сохранённых pageToken; протухли — честно просим
  // нажать «Найти» заново, а не ищем молча за те же деньги.
  if (out.status === "expired") {
    return apiError(
      "Прошлая выдача устарела — нажмите «Найти», чтобы искать заново",
      409,
      "CMP_EXPIRED"
    );
  }
  if (out.status === "no_keys") {
    return apiError(
      "Поиск по YouTube не настроен — обратитесь к администратору",
      503,
      "YT_NO_KEYS"
    );
  }
  if (out.status === "quota") {
    return apiError(
      "Лимит запросов к YouTube на сегодня исчерпан — обновится ночью",
      429,
      "YT_QUOTA"
    );
  }
  if (out.status === "error") return apiError(out.message, 502);

  return NextResponse.json({
    result: out.result,
    cached: "cached" in out ? out.cached : true,
  });
}
