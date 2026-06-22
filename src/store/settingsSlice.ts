import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlanId } from "./authSlice";
import type { LlmProvider } from "@/lib/llm/types";

// Пользовательские настройки. Персистятся в localStorage (см. StoreProvider).
// `aboutYou` подгружается в нейронку во всех чатах (см. ChatInput → /api/chat).
// `plan` — источник правды для биллинга (мок, без бэкенда).
// `provider` — выбранный движок модели (Claude / GLM), едет в /api/chat.

export type Language = "ru";

interface SettingsState {
  aboutYou: string;
  language: Language;
  plan: PlanId;
  provider: LlmProvider;
}

const initialState: SettingsState = {
  aboutYou: "",
  language: "ru",
  plan: "start",
  provider: "claude",
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
    setProvider(state, action: PayloadAction<LlmProvider>) {
      state.provider = action.payload;
    },
    hydrateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      Object.assign(state, action.payload);
    },
  },
});

export const { setAboutYou, setLanguage, setPlan, setProvider, hydrateSettings } =
  settingsSlice.actions;
export default settingsSlice.reducer;
