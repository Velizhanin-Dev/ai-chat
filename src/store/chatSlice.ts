import { createSlice, PayloadAction, nanoid } from "@reduxjs/toolkit";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  // Стрим/ошибка относятся к активному диалогу (одновременно генерируется один).
  isLoading: boolean;
  streamingContent: string;
  error: string | null;
  // Тик-сигнал «поставь фокус в поле ввода» (растёт при «Новый чат»). UI-only,
  // не персистится — ChatInput фокусирует textarea при изменении значения.
  inputFocusSignal: number;
  // Завершена ли гидратация из localStorage. Пока false — сайдбар показывает
  // скелетоны вместо «Пока нет диалогов» (иначе мелькает ложное «пусто»).
  hydrated: boolean;
}

const DEFAULT_TITLE = "Новый чат";
const TITLE_MAX = 40;

function nowIso() {
  return new Date().toISOString();
}

function titleFromText(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return DEFAULT_TITLE;
  return clean.length > TITLE_MAX ? clean.slice(0, TITLE_MAX).trimEnd() + "…" : clean;
}

export function makeConversation(): Conversation {
  const ts = nowIso();
  return {
    id: nanoid(),
    title: DEFAULT_TITLE,
    messages: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

const initialState: ChatState = {
  conversations: [],
  activeId: null,
  isLoading: false,
  streamingContent: "",
  error: null,
  inputFocusSignal: 0,
  hydrated: false,
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    createConversation: {
      reducer(state, action: PayloadAction<Conversation>) {
        state.conversations.unshift(action.payload);
        state.activeId = action.payload.id;
        state.streamingContent = "";
        state.error = null;
      },
      prepare() {
        return { payload: makeConversation() };
      },
    },
    setActiveConversation(state, action: PayloadAction<string>) {
      if (state.conversations.some((c) => c.id === action.payload)) {
        state.activeId = action.payload;
        state.streamingContent = "";
        state.error = null;
      }
    },
    // Пустое состояние «новый чат»: сам диалог создаётся только при первом
    // сообщении (см. ChatInput) — как в ChatGPT/Claude и т.п.
    startNewChat(state) {
      state.activeId = null;
      state.streamingContent = "";
      state.error = null;
      state.inputFocusSignal += 1;
    },
    deleteConversation(state, action: PayloadAction<string>) {
      state.conversations = state.conversations.filter((c) => c.id !== action.payload);
      if (state.activeId === action.payload) {
        // Уходим в пустое «новое» состояние, а не в соседний диалог.
        state.activeId = null;
        state.streamingContent = "";
        state.error = null;
      }
    },
    renameConversation(
      state,
      action: PayloadAction<{ id: string; title: string }>
    ) {
      const conv = state.conversations.find((c) => c.id === action.payload.id);
      if (conv) conv.title = action.payload.title.trim() || DEFAULT_TITLE;
    },
    addMessage(state, action: PayloadAction<ChatMessage>) {
      const conv = state.conversations.find((c) => c.id === state.activeId);
      if (!conv) return;
      conv.messages.push(action.payload);
      conv.updatedAt = action.payload.createdAt;
      // Заголовок диалога = первое сообщение пользователя.
      if (
        action.payload.role === "user" &&
        (conv.title === DEFAULT_TITLE || !conv.title)
      ) {
        conv.title = titleFromText(action.payload.content);
      }
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setStreamingContent(state, action: PayloadAction<string>) {
      state.streamingContent = action.payload;
    },
    appendStreamingContent(state, action: PayloadAction<string>) {
      state.streamingContent += action.payload;
    },
    finalizeStreaming(state) {
      state.streamingContent = "";
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    hydrate(
      state,
      action: PayloadAction<{ conversations: Conversation[]; activeId: string | null }>
    ) {
      state.conversations = action.payload.conversations;
      state.activeId =
        action.payload.activeId &&
        action.payload.conversations.some((c) => c.id === action.payload.activeId)
          ? action.payload.activeId
          : action.payload.conversations[0]?.id ?? null;
      state.hydrated = true;
    },
    // Помечаем гидратацию завершённой, даже если в localStorage пусто (hydrate
    // тогда не вызывается). Вызывается из StoreProvider после загрузки.
    chatHydrated(state) {
      state.hydrated = true;
    },
  },
});

export const {
  createConversation,
  setActiveConversation,
  startNewChat,
  deleteConversation,
  renameConversation,
  addMessage,
  setLoading,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
  hydrate,
  chatHydrated,
} = chatSlice.actions;

export default chatSlice.reducer;
