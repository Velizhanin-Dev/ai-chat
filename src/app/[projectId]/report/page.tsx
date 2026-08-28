import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { getPlans } from "@/lib/plans";
import { assertOwnedProject } from "@/lib/youtube";
import ChannelReport from "@/components/Channel/ChannelReport";

export const dynamic = "force-dynamic";

// Отчёт по каналу для КЛИЕНТА продюсера.
//
// ⚠️ Страница намеренно вне обвязки приложения (её нет в списке роутов AppShell):
// это документ, который распечатывают или сохраняют в PDF и отправляют клиенту.
// Сайдбар с чужими проектами и меню разделов в таком документе неуместны.
//
// ⚠️ PDF собираем ПЕЧАТЬЮ БРАУЗЕРА, а не серверной библиотекой. Причина простая:
// в стандартных шрифтах PDF нет кириллицы, и любой серверный генератор пришлось
// бы кормить встроенным шрифтом, а тяжёлый headless-браузер тянуть в образ ради
// одной кнопки — тем более. Печать делает то же самое, рендерит кириллицу
// идеально и даёт человеку привычное «Сохранить как PDF».
export default async function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) notFound();

  const { projectId } = await params;
  if (!(await assertOwnedProject(user.id, projectId))) notFound();

  // Гейт по тарифу — СЕРВЕРНЫЙ. Кнопку на клиенте мы прячем, но прятать мало:
  // адрес страницы угадывается, и без этой проверки функция была бы бесплатной.
  if (!isAdmin(user)) {
    const plans = await getPlans();
    const plan = plans.find((p) => p.id === user.plan);
    if (!plan || plan.limits.reports <= 0) notFound();
  }

  return <ChannelReport projectId={projectId} />;
}
