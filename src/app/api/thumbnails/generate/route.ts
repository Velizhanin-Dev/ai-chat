import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { generateImage } from "@/lib/llm/image";
import { readUpload, saveUpload, IMAGE_MIME_EXT } from "@/lib/uploads";
import {
  buildThumbnailPrompt,
  sanitizeSpec,
  isSpecReady,
  normalizeRefRole,
  MAX_REFERENCES,
} from "@/lib/thumbnails";
import {
  requireProjectAccess,
  checkQuota,
  spendQuota,
  toRow,
  THUMBNAIL_GENERATE_QUOTA_COST,
} from "@/lib/thumbnails-server";
import { track } from "@/lib/achievements-server";

// Генерация превью. Тратит 1 запрос квоты (как ИИ-разбор видео) — списываем
// только ПОСЛЕ успеха. Картинка кладётся на диск, метаданные + промпт + спека —
// в БД, чтобы генерацию можно было повторить и разобрать, что пошло не так.
export const dynamic = "force-dynamic";
// Картинка генерится дольше текста; на Vercel-подобных рантаймах нужен запас.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";

  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.res;

  const denied = await checkQuota(access.user);
  if (denied) return denied.res;

  const spec = sanitizeSpec(body?.spec);
  if (!isSpecReady(spec)) {
    return apiError("Опишите, что показать на превью");
  }

  // Перегенерация из редактора — вариация исходного превью. Корнем группы
  // считаем самое первое превью: цепочки «вариация вариации» не плодим, иначе
  // галерея не сможет схлопнуть группу в одну карточку.
  const rawParent = typeof body?.parentId === "string" ? body.parentId : "";
  let parentId: string | null = null;
  if (rawParent) {
    const parent = await prisma.thumbnail.findFirst({
      where: { id: rawParent, conversationId: access.conversationId, kind: "generation" },
      select: { id: true, parentId: true },
    });
    parentId = parent ? parent.parentId ?? parent.id : null;
  }

  // Референсы: берём ТОЛЬКО те, что реально принадлежат этому проекту, и в том
  // порядке, в каком их прислал клиент (порядок = Image 1..N в промпте).
  const wantIds = Array.isArray(body?.refIds)
    ? (body.refIds as unknown[])
        .filter((v): v is string => typeof v === "string")
        .slice(0, MAX_REFERENCES)
    : [];
  const refRows = wantIds.length
    ? await prisma.thumbnail.findMany({
        where: {
          id: { in: wantIds },
          conversationId: access.conversationId,
          kind: "reference",
        },
      })
    : [];
  const ordered = wantIds
    .map((id) => refRows.find((r) => r.id === id))
    .filter((r): r is (typeof refRows)[number] => Boolean(r));

  const prompt = buildThumbnailPrompt(
    spec,
    ordered.map((r) => ({ role: normalizeRefRole(r.role), label: r.label }))
  );

  try {
    const references = await Promise.all(
      ordered.map(async (r) => ({
        mime: r.mimeType,
        base64: (await readUpload(r.filePath)).toString("base64"),
      }))
    );

    const settings = await getSettings();
    const image = await generateImage({
      prompt,
      references,
      model: settings.imageModel,
      meta: { userId: access.user.id, conversationId: access.conversationId },
    });

    const mime = IMAGE_MIME_EXT[image.mime] ? image.mime : "image/jpeg";
    const filePath = await saveUpload(image.data, {
      mime,
      dir: access.conversationId,
    });

    const row = await prisma.thumbnail.create({
      data: {
        conversationId: access.conversationId,
        userId: access.user.id,
        kind: "generation",
        role: "speaker",
        label: spec.thumbText.slice(0, 120),
        filePath,
        mimeType: mime,
        bytes: image.data.length,
        refIds: ordered.map((r) => r.id),
        parentId,
        spec: spec as unknown as object,
        prompt,
        model: image.model,
        costUsd: image.costUsd,
      },
    });

    await spendQuota(access.user, THUMBNAIL_GENERATE_QUOTA_COST);

    // Геймификация (docs/achievements.md), fire-and-forget.
    track(access.user.id, "thumbnail_generated");

    return NextResponse.json({ item: toRow(row) });
  } catch (err) {
    console.error("[thumbnails generate]", err);
    const msg = err instanceof Error ? err.message : "Не удалось сгенерировать превью";
    return apiError(msg, 502, "IMAGE_ERROR");
  }
}
