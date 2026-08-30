import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { saveUpload } from "@/lib/uploads";
import { MAX_REFERENCES } from "@/lib/thumbnails";
import { requireProjectAccess } from "@/lib/thumbnails-server";
import { toRow } from "@/lib/thumbnails-row";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Превью УЖЕ ВЫШЕДШЕГО ролика канала → стиль-референс генератора.
//
// ⚠️ Зачем: у канала обычно есть сложившийся вид обложек, и новое превью должно
// его продолжать, а не начинать дизайн с нуля. Загружать свои же обложки руками
// (найти ролик → скачать картинку → залить файлом) никто не будет — поэтому
// кнопка «из роликов канала» тянет их сама. Работает и для OAuth-канала, и для
// привязанного по ссылке: превью публичны, нужен только videoId.
//
// ⚠️ Квоту тарифа НЕ тратит и в YouTube API не ходит вовсе: адрес картинки
// выводится из id ролика (i.ytimg.com/vi/<id>/...).

// Прод стоит в РФ, где i.ytimg.com может не открываться — качаем через тот же
// зарубежный прокси, что отдаёт превью браузеру (/img/image). Переменная
// доступна и серверу: NEXT_PUBLIC_* инлинится в клиент, но в process.env она
// лежит как обычная. Не задана — идём напрямую (локальная разработка).
function thumbFetchUrl(direct: string): string {
  const proxy = (process.env.NEXT_PUBLIC_YT_IMG_PROXY || "").replace(/\/$/, "");
  return proxy ? `${proxy}/image?u=${encodeURIComponent(direct)}` : direct;
}

// maxres есть не у всех роликов (старые/шортсы) — падаем по лесенке качества.
const QUALITIES = ["maxresdefault", "sddefault", "hqdefault"] as const;

async function downloadThumb(videoId: string): Promise<{ data: Buffer; mime: string } | null> {
  for (const q of QUALITIES) {
    const direct = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
    try {
      const res = await fetch(thumbFetchUrl(direct), {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // ⚠️ У отсутствующего качества YouTube отдаёт 200 с серой заглушкой
      // 120×90 (~1 КБ) — её надо отсечь по размеру, а не по коду ответа.
      if (buf.length < 5_000) continue;
      return { data: buf, mime: res.headers.get("content-type") || "image/jpeg" };
    } catch {
      /* следующее качество */
    }
  }
  return null;
}

// POST { projectId, videoId, label? } — скачать превью ролика и сохранить как
// стиль-референс проекта. Тот же потолок MAX_REFERENCES, что у ручной загрузки.
export async function POST(req: Request) {
  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  if (!/^[\w-]{6,20}$/.test(videoId)) return apiError("Не понял, какой это ролик");

  const existing = await prisma.thumbnail.count({
    where: { conversationId: access.conversationId, kind: "reference" },
  });
  if (existing >= MAX_REFERENCES) {
    return apiError(
      `Больше ${MAX_REFERENCES} референсов на проект — удалите лишние`,
      400,
      "REF_LIMIT"
    );
  }

  const thumb = await downloadThumb(videoId);
  if (!thumb) {
    return apiError("Не удалось скачать превью этого ролика — попробуйте другой", 502);
  }

  const filePath = await saveUpload(thumb.data, {
    mime: thumb.mime,
    dir: access.conversationId,
  });

  const row = await prisma.thumbnail.create({
    data: {
      conversationId: access.conversationId,
      userId: access.user.id,
      kind: "reference",
      // Роль всегда «стиль»: обложка канала — образец РАСКЛАДКИ и подачи.
      // Спикером её делать нельзя — на ней он мелкий и с плашками текста,
      // IDENTITY LOCK по такому референсу сработает хуже, чем по чистому фото.
      role: "style",
      label: String(body?.label ?? "").trim().slice(0, 120) || "Превью с канала",
      filePath,
      mimeType: thumb.mime,
      bytes: thumb.data.length,
    },
  });

  return NextResponse.json({ item: toRow(row) });
}
