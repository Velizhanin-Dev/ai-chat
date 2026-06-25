import { NextResponse } from "next/server";
import { getActivePlans } from "@/lib/plans";

// Публичные активные тарифы — для биллинга в настройках (клиентская модалка) и
// прочих клиентских витрин. Лендинг читает план серверно (см. app/page.tsx).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ plans: await getActivePlans() });
}
