import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlanId } from "./authSlice";

// Пользовательские настройки. Персистятся в localStorage (см. StoreProvider).
// `aboutYou` подгружается в нейронку во всех чатах (см. ChatInput → /api/chat).
// `plan` — источник правды для биллинга (мок, без бэкенда).

export type Language = "ru";

interface SettingsState {
  aboutYou: string;
  language: Language;
  plan: PlanId;
}

const initialState: SettingsState = {
  aboutYou: "",
  language: "ru",
  plan: "start",
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setAboutYou(state, action: PayloadAction<string>) {
      state.aboutYou = action.payload;
    },
    setLanguage(state, action: PayloadAction<Language>) {
      state.language = action.payload;
    },
    setPlan(state, action: PayloadAction<PlanId>) {
      state.plan = action.payload;
    },
    hydrateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      Object.assign(state, action.payload);
    },
  },
});

export const { setAboutYou, setLanguage, setPlan, hydrateSettings } =
  settingsSlice.actions;
export default settingsSlice.reducer;
