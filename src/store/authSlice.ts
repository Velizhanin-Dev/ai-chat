import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// ── Лёгкий МОК авторизации ────────────────────────────────────────────────
// Бэкенд на заглушках: «вход»/«регистрация» просто кладут фейкового юзера в
// стейт. Без сервера, без токенов, без персиста (стейт живёт до перезагрузки
// страницы). Цель — дать прокликать весь продукт, а не реальная auth-логика.

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
}

interface AuthState {
  user: AuthUser | null;
}

const initialState: AuthState = { user: null };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    authenticated(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
    },
    setPlan(state, action: PayloadAction<PlanId>) {
      if (state.user) state.user.plan = action.payload;
    },
    loggedOut(state) {
      state.user = null;
    },
  },
});

export const { authenticated, setPlan, loggedOut } = authSlice.actions;
export default authSlice.reducer;

// Хелпер: собрать правдоподобное имя/юзера из email для мок-входа.
export function mockUserFromEmail(email: string, plan: PlanId = "blogger"): AuthUser {
  const raw = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const name = raw
    ? raw
        .split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ")
    : "Пользователь";
  return { id: "mock-user", name, email, plan };
}
