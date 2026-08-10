import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { getSettings, isLaunchLocked } from "@/lib/settings";
import { isAdmin } from "@/lib/admin";
import { getQuotaState } from "@/lib/quota";
import { sanitizeBrief, isBriefComplete, type Brief } from "@/lib/brief";
import { assertOwnedProject } from "@/lib/youtube";
import { enqueueJob, findRunningJob } from "@/lib/jobs-server";
import { DIAGNOSE_PERIODS } from "@/lib/youtube-types";
import type { DiagnoseKind } from "@/lib/youtube-types";

// Разбор канала по параметрам органического продвижения (кнопка «Разобрать канал»
// в разделе «Канал»). Сервер собирает цифры из Analytics API, модель выставляет по
// каждому параметру балл 0-100 и говорит, что чинить. ТРАТИТ 1 запрос квоты.
// Каждый разбор сохраняется в ChannelAnalysis — история видна в UI.

const KINDS: DiagnoseKind[] = ["all", "long", "shorts"];

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const { searchParams } = new URL(req.url);
  const owned = await assertOwnedProject(user.id, searchParams.get("projectId") ?? "");
  if (!owned) return apiError("Проект не найден", 404);

  const rows = await prisma.channelAnalysis.findMany({
    where: { conversationId: owned },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({
    analyses: rows.map((r) => ({
      id: r.id,
      kind: r.kind as DiagnoseKind,
      periodDays: r.periodDays,
      overallScore: r.overallScore,
      createdAt: r.createdAt.toISOString(),
      manualCtr: r.manualCtr,
      metrics: r.metrics,
      result: r.result,
    })),
  });
}

// ── POST: новый разбор ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const settings = await getSettings();
  if (isLaunchLocked(settings) && !isAdmin(user)) {
    return apiError("Доступ откроется после запуска", 403, "LAUNCH_LOCKED");
  }

  const body = await readJson(req);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const kind: DiagnoseKind = KINDS.includes(body?.kind as DiagnoseKind)
    ? (body!.kind as DiagnoseKind)
    : "all";
  const periodDays = (DIAGNOSE_PERIODS as readonly number[]).includes(Number(body?.periodDays))
    ? Number(body!.periodDays)
    : 28;
  // CTR из Studio: 0-100, всё остальное игнорируем.
  const rawCtr = Number(body?.manualCtr);
  const manualCtr = Number.isFinite(rawCtr) && rawCtr > 0 && rawCtr <= 100 ? rawCtr : null;

  const owned = await assertOwnedProject(user.id, projectId);
  if (!owned) return apiError("Проект не найден", 404);

  const conv = await prisma.conversation.findUnique({
    where: { id: owned },
    select: { brief: true },
  });
  const brief: Brief | null = isBriefComplete(sanitizeBrief(conv?.brief))
    ? sanitizeBrief(conv?.brief)
    : null;

  const integ = await prisma.youTubeIntegration.findUnique({ where: { conversationId: owned } });
  if (!integ) return apiError("YouTube не подключён", 404);

  // Квота: разбор канала тратит 1 запрос (как ответ в чате). Админам не лимитируем.
  if (!isAdmin(user)) {
    const quota = await getQuotaState(user);
    if (quota.reason === "expired") {
      return apiError(
        "Срок тарифа истёк. Подключите тариф в настройках → Биллинг.",
        403,
        "PLAN_EXPIRED"
      );
    }
    if (quota.reason === "quota") {
      return apiError(
        "Запросы на тарифе закончились. Подключите тариф повыше в настройках → Биллинг.",
        403,
        "QUOTA_EXCEEDED"
      );
    }
  }

  // Дальше — в фон: сбор цифр из Analytics API плюс генерация занимают десятки
  // секунд, и раньше обновление страницы убивало разбор вместе со списанной квотой.
  const dup = await findRunningJob({
    userId: user.id,
    kind: "channel_diagnose",
    conversationId: owned,
  });
  if (dup) return NextResponse.json({ job: dup, duplicate: true });

  const job = await enqueueJob({
    kind: "channel_diagnose",
    userId: user.id,
    conversationId: owned,
    payload: { projectId, kind, periodDays, manualCtr },
  });
  return NextResponse.json({ job });
}
