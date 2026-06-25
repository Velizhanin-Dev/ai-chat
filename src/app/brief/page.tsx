import { notFound } from "next/navigation";
import { getSettings } from "@/lib/settings";
import BriefStandaloneClient from "./BriefStandaloneClient";

// Серверный гейт: страница брифа по QR живёт за фичефлагом briefPageEnabled
// (правится из админки). Выкл → 404. Включёно → рендерим клиентский визард.
export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const { briefPageEnabled } = await getSettings();
  if (!briefPageEnabled) notFound();
  return <BriefStandaloneClient />;
}
