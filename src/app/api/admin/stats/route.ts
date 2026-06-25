import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { getDashboardData } from "@/lib/stats";

// Агрегаты для CRM-дашборда админки (деньги, запросы, чаты, токены, топ юзеров).
// Только для админа; не-админу — 404 (не светим существование админки).
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  const data = await getDashboardData(days);
  return NextResponse.json({ data });
}
