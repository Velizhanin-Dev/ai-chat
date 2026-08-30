import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { apiError, readJson } from "@/lib/http";
import {
  getSettings,
  saveSettings,
  normalizeWebSearch,
  normalizeTrialHours,
  type AppSettings,
} from "@/lib/settings";

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
  if (
    input.provider === "claude" ||
    input.provider === "glm" ||
    input.provider === "openrouter"
  ) {
    patch.provider = input.provider;
  }
  if (typeof input.openrouterModel === "string") {
    patch.openrouterModel = input.openrouterModel.trim().slice(0, 120);
  }
  if (input.openrouterParams && typeof input.openrouterParams === "object") {
    // Нормализация (белый список ключей + зажим диапазонов) — внутри saveSettings.
    patch.openrouterParams = input.openrouterParams;
  }
  if (typeof input.openrouterProvider === "string") {
    // slug провайдера (или "" — авто-балансировка). Только slug-символы.
    patch.openrouterProvider = input.openrouterProvider
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/_-]/g, "")
      .slice(0, 60);
  }
  if (typeof input.openrouterStructuredModel === "string") {
    patch.openrouterStructuredModel = input.openrouterStructuredModel.trim().slice(0, 120);
  }
  if (typeof input.openrouterStructuredProvider === "string") {
    patch.openrouterStructuredProvider = input.openrouterStructuredProvider
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/_-]/g, "")
      .slice(0, 60);
  }
  if (typeof input.imageModel === "string") {
    patch.imageModel = input.imageModel.trim().slice(0, 120);
  }
  if (input.routing === "smart" || input.routing === "full") {
    patch.routing = input.routing;
  }
  // Срок пробного периода (кламп 1–168 ч внутри normalizeTrialHours).
  if (input.trialHours != null) {
    patch.trialHours = normalizeTrialHours(input.trialHours);
  }
  // Веб-поиск: enabled + число результатов (кламп 1–5 внутри normalizeWebSearch —
  // каждый результат платный, потолок осознанный).
  if (input.webSearch && typeof input.webSearch === "object") {
    patch.webSearch = normalizeWebSearch(input.webSearch);
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
