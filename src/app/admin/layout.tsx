import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import AdminShell from "@/components/Admin/AdminShell";

// Гейт всей зоны /admin: не-админ получает 404 (не светим существование).
// Проверка серверная (роль из БД), поэтому без релогина и без правок middleware.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) notFound();

  return <AdminShell userName={admin.name}>{children}</AdminShell>;
}
