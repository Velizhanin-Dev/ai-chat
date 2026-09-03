import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { assertOwnedProject } from "@/lib/youtube";
import { collectAudienceQuestions } from "@/lib/audience-questions-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/channel/questions?projectId=…&refresh=1 — о чём спрашивают зрители под
// роликами канала.
//
// ⚠️ Квоту тарифа НЕ тратит (тут нет вызова модели), но тратит ~11 units пула
// ключей: по одному запросу комментариев на ролик. Поэтому кэш 6 часов, а свежий
// сбор — только по кнопке «Обновить». У Instagram-проекта — то же, но под токеном
// аккаунта (ветка внутри collectAudienceQuestions), units пула не тратит.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId || !(await assertOwnedProject(user.id, projectId))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const outcome = await collectAudienceQuestions(projectId, force);

  if (outcome.status === "no_keys") {
    return NextResponse.json({ error: "Разбор комментариев не настроен", code: "NO_KEYS" }, { status: 503 });
  }
  if (outcome.status === "not_connected") {
    return NextResponse.json({ error: "Канал не подключён", code: "NOT_CONNECTED" }, { status: 409 });
  }
  if (outcome.status === "reauth") {
    return NextResponse.json(
      { error: "Доступ к Instagram истёк — подключите аккаунт заново в настройках проекта", code: "IG_REAUTH" },
      { status: 409 }
    );
  }
  if (outcome.status === "error") {
    return NextResponse.json({ error: outcome.message }, { status: 502 });
  }

  return NextResponse.json({ result: outcome.result, cached: outcome.cached });
}
