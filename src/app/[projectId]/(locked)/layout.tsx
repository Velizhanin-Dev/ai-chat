import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";

// Серверный админ-гвард для закрытых разделов проекта (Канал / Генератор
// креативов / Разборы): /{projectId}/channel|creatives|reviews. Не-админ (и гость)
// получает 404 — недоступны по прямому URL, даже минуя задизейбленные вкладки в
// TopNav. Тот же паттерн, что и /admin (getAdminUser + notFound, роль из БД).
// Route-group (locked) не влияет на URL.
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
