import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { fetchVideoTags } from "@/lib/youtube-scrape";
import { videoIdFromUrl } from "@/lib/competitors";
import { aggregateTags } from "@/lib/keywords";

// Сколько роликов разбираем на банк тегов за раз. ⚠️ Потолок не про квоту (её тут
// нет вовсе), а про время и трафик: за каждым роликом отдельная страница.
const MAX_BANK_VIDEOS = 8;

export const dynamic = "force-dynamic";

// GET /api/competitors/tags?v=… — теги чужого ролика.
//
// ⚠️ В Data API их нет: с 2021 `videos.list` отдаёт теги только владельцу канала.
// Но на странице ролика они лежат открыто (и в плеерном JSON, и в meta) — на этом
// построены «покажи теги конкурента» у vidIQ и TubeBuddy. Стоит 0 units.
// ⚠️ Не достали — 200 с пустым списком, а не ошибка: путь неофициальный, и
// карточка обязана работать без тегов.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get("v") ?? "").trim();
  const videoId = /^[\w-]{6,20}$/.test(raw) ? raw : videoIdFromUrl(raw);
  if (!videoId) return NextResponse.json({ error: "Плохой id ролика" }, { status: 400 });

  const data = await fetchVideoTags(videoId).catch(() => null);
  return NextResponse.json({ tags: data?.tags ?? [], title: data?.title ?? "" });
}

// POST /api/competitors/tags — банк тегов ниши: чем размечают ролики те, у кого
// уже сработало. Тело: { ids: string[] }.
//
// ⚠️ Считаем по ЧИСЛУ роликов, где тег встретился, а не по просмотрам: один
// залетевший ролик иначе протащит наверх свои случайные теги (см. aggregateTags).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const body = await readJson(req);
  const raw = Array.isArray(body?.ids) ? body.ids : [];
  const ids = raw
    .filter((v: unknown): v is string => typeof v === "string" && /^[\w-]{6,20}$/.test(v))
    .slice(0, MAX_BANK_VIDEOS);
  if (ids.length === 0) return NextResponse.json({ bank: [], scanned: 0 });

  const pages = await Promise.all(ids.map((id) => fetchVideoTags(id).catch(() => null)));
  const withTags = pages.filter((p): p is NonNullable<typeof p> => !!p && p.tags.length > 0);

  return NextResponse.json({
    bank: aggregateTags(withTags),
    // Сколько роликов реально отдали теги: часть авторов их не заполняет, и
    // «12 тегов из 8 роликов» без этой цифры читается как полный обзор ниши.
    scanned: withTags.length,
    requested: ids.length,
  });
}
