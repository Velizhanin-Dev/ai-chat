import { configureStore } from "@reduxjs/toolkit";
import chatReducer from "./chatSlice";
import ingestReducer from "./ingestSlice";
import authReducer from "./authSlice";
import settingsReducer from "./settingsSlice";

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    ingest: ingestReducer,
    auth: authReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
