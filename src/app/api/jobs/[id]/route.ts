import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getOwnJob } from "@/lib/jobs-server";

// Статус одной фоновой задачи. Клиент опрашивает этот роут, пока задача не
// придёт в терминальное состояние; результат лежит прямо тут, поэтому его
// видно и после перезагрузки страницы, и с другого устройства.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return apiError("Требуется вход", 401);

  // getOwnJob фильтрует по userId — чужую задачу по перебору id не достать.
  const job = await getOwnJob(params.id, user.id);
  if (!job) return apiError("Задача не найдена", 404);

  return NextResponse.json({ job });
}
