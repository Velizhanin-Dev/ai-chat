import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";

// Чтение/запись глобальных настроек (фичефлаги: бриф вкл/выкл, таймер запуска).
// Только для админа; не-админу — 404 (не светим существование админки).

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);
  return NextResponse.json({ settings: await getSettings() });
}

export async function PATCH(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return apiError("Not found", 404);

  const body = (await readJson(req)) as { settings?: Partial<AppSettings> } | null;
  const input = body?.settings ?? {};

  // Валидируем и нормализуем то, что пришло (доверять клиенту нельзя).
  const patch: Partial<AppSettings> = {};
  if (typeof input.briefPageEnabled === "boolean") {
    patch.briefPageEnabled = input.briefPageEnabled;
  }
  if (input.provider === "claude" || input.provider === "glm") {
    patch.provider = input.provider;
  }
  if (input.launch && typeof input.launch === "object") {
    const { countdownEnabled, targetAt } = input.launch;
    let iso: string | null = null;
    if (typeof targetAt === "string" && targetAt.trim()) {
      const d = new Date(targetAt);
      if (Number.isNaN(d.getTime())) return apiError("Некорректная дата запуска", 400);
      iso = d.toISOString();
    }
    patch.launch = {
      countdownEnabled: Boolean(countdownEnabled),
      targetAt: iso,
    };
  }

  const settings = await saveSettings(patch);
  return NextResponse.json({ settings });
}
