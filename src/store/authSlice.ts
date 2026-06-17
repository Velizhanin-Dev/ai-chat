import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// ── Auth (реальный бэкенд) ────────────────────────────────────────────────
// Источник правды — httpOnly-cookie с JWT на сервере (см. src/lib/auth.ts).
// В Redux держим только «снимок» пользователя для UI; он гидратируется через
// GET /api/auth/me при загрузке приложения (см. StoreProvider).

export type PlanId = "start" | "blogger" | "studio";

export const PLAN_LABEL: Record<PlanId, string> = {
  start: "Старт",
  blogger: "Блогер",
  studio: "Студия",
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  emailVerified: boolean;
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
    loggedOut(state) {
      state.user = null;
      state.ready = true;
    },
  },
});

export const { authenticated, authHydrated, setPlan, loggedOut } = authSlice.actions;
export default authSlice.reducer;
