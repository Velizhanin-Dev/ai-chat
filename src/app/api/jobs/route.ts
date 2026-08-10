import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { listActiveJobs, ensureWorker } from "@/lib/jobs-server";
import { isJobKind } from "@/lib/jobs";

// Незавершённые задачи пользователя. Зачем: страница, открытая заново (или на
// другом устройстве), должна показать «идёт генерация», а не пустой экран.
// Клиент дёргает это на маунте и подхватывает свою задачу по kind/проекту.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("Требуется вход", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const kindParam = url.searchParams.get("kind");

  // Рестарт мог убить воркер вместе с процессом — поднимаем его при первом же
  // вопросе «что у меня в работе».
  void ensureWorker();

  const jobs = await listActiveJobs({
    userId: user.id,
    conversationId: projectId,
    kind: isJobKind(kindParam) ? kindParam : undefined,
  });

  return NextResponse.json({ jobs });
}
