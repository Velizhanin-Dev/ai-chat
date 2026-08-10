import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Brief } from "@/lib/brief";

// ── Auth (реальный бэкенд) ────────────────────────────────────────────────
// Источник правды — httpOnly-cookie с JWT на сервере (см. src/lib/auth.ts).
// В Redux держим только «снимок» пользователя для UI; он гидратируется через
// GET /api/auth/me при загрузке приложения (см. StoreProvider).

// ⚠️ Тарифы заводятся в админке (таблица Plan) — id произвольный slug, а НЕ union
// из трёх значений, как было раньше. Поэтому тип — обычная строка; источник правды
// по названию/лимитам — БД (getPlans / GET /api/plans), а не константы ниже.
export type PlanId = string;

// Легаси-фолбэк для ПЕРВОНАЧАЛЬНЫХ тарифов: подписи и цвета бейджей, пока не
// подгрузился список из БД. Для новых тарифов подпись берётся из Plan.label,
// цвет — детерминированно из id (см. planBadgeColor в components/Admin/Badges).
export const PLAN_LABEL: Record<string, string> = {
  start: "Пробный",
  blogger: "Базовый",
  studio: "Максимальный",
};

// Порядок исходных тарифов по возрастанию (легаси; актуальный порядок витрины —
// поле Plan.order из админки).
export const PLAN_ORDER: string[] = ["start", "blogger", "studio"];

export const PLAN_BADGE_COLOR: Record<string, string> = {
  start: "gray",
  blogger: "teal",
  studio: "grape",
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  // Роль из БД: "user" | "admin". Используется, чтобы показать вход в админку.
  role: string;
  // До какого момента активен тариф (ISO) или null. Пробный — +1 час от
  // регистрации, платный — +30 дней от оплаты.
  planExpiresAt: string | null;
  // Сколько запросов израсходовано в текущем периоде тарифа (для остатка квоты).
  requestsUsed: number;
  emailVerified: boolean;
  // Бриф клиента + тип харизмы (DISC). null = не проходил бриф.
  brief: Brief | null;
  // Прошёл ли обязательный бриф (серверный флаг). Гейт перед чатом смотрит сюда.
  briefCompleted: boolean;
}

interface AuthState {
  user: AuthUser | null;
  // false до первого ответа /api/auth/me — чтобы UI не моргал «гость → юзер».
  ready: boolean;
}

const initialState: AuthState = { user: null, ready: false };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    // Успешный вход/регистрация.
    authenticated(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      state.ready = true;
    },
    // Результат гидратации с сервера (юзер или гость) — помечает ready.
    authHydrated(state, action: PayloadAction<AuthUser | null>) {
      state.user = action.payload;
      state.ready = true;
    },
    setPlan(state, action: PayloadAction<PlanId>) {
      if (state.user) state.user.plan = action.payload;
    },
    // Оптимистично списываем запросы на клиенте после успешного ответа — чтобы
    // остаток квоты в биллинге не отставал до следующей гидратации с сервера.
    // По умолчанию 1 (ответ чата/разбор), генерация превью списывает 10.
    bumpRequestsUsed(state, action: PayloadAction<number | undefined>) {
      if (state.user) state.user.requestsUsed += action.payload ?? 1;
    },
    loggedOut(state) {
      state.user = null;
      state.ready = true;
    },
  },
});

export const { authenticated, authHydrated, setPlan, bumpRequestsUsed, loggedOut } =
  authSlice.actions;
export default authSlice.reducer;
