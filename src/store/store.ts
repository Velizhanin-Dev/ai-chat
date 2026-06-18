import { combineReducers, configureStore } from "@reduxjs/toolkit";
import chatReducer from "./chatSlice";
import authReducer from "./authSlice";
import settingsReducer from "./settingsSlice";

const rootReducer = combineReducers({
  chat: chatReducer,
  auth: authReducer,
  settings: settingsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

// Стор создаётся per-request (для SSR-засева юзера из cookie) и один раз на
// клиенте. preloadedState засевает auth, чтобы серверный HTML и первый
// клиентский рендер совпадали — без мигания «гость → юзер» и без hydration
// mismatch. Синглтон не держим: на сервере он бы шарился между запросами и
// утёк бы чужой юзер.
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as RootState | undefined,
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];
