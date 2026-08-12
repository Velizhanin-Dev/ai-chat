import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";

// Серверный админ-гвард для закрытых разделов проекта. Сейчас под ним:
// /{projectId}/creatives (заглушка «в разработке») и /{projectId}/competitors
// («Конкуренты в нише» — дорогой по квоте YouTube поиск). Не-админ (и гость)
// получает 404 — разделы недоступны по прямому URL, даже минуя задизейбленные
// вкладки в TopNav. Тот же паттерн, что и /admin (getAdminUser + notFound, роль из
// БД). Route-group (locked) не влияет на URL.
// Разделы, которые открывали всем (channel, thumbnails), из группы выносились —
// одного снятия флага adminOnly в TopNav мало, гвард отдал бы им 404.
export const dynamic = "force-dynamic";

export default async function LockedProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <>{children}</>;
}
