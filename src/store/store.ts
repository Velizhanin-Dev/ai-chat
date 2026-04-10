import { configureStore } from "@reduxjs/toolkit";
import chatReducer from "./chatSlice";
import ingestReducer from "./ingestSlice";

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    ingest: ingestReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
