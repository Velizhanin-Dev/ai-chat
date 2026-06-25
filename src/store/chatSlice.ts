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
  // Подгружены ли сообщения с сервера. В списке диалоги приходят метаданными
  // (messages: []), сообщения тянутся лениво при открытии. У новосозданного
  // диалога — true (он пуст и весь в памяти).
  messagesLoaded: boolean;
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  // Стрим/ошибка относятся к активному диалогу (одновременно генерируется один).
  isLoading: boolean;
  streamingContent: string;
  error: string | null;
  // Идёт ленивая подгрузка сообщений открытого диалога с сервера.
  messagesLoading: boolean;
  // Тик-сигнал «поставь фокус в поле ввода» (растёт при «Новый чат»). UI-only,
  // не персистится — ChatInput фокусирует textarea при изменении значения.
  inputFocusSignal: number;
  // Завершена ли загрузка списка диалогов с сервера. Пока false — сайдбар
  // показывает скелетоны вместо «Пока нет диалогов» (иначе мелькает ложное «пусто»).
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
    messagesLoaded: true, // новый диалог пуст и целиком в памяти
  };
}

const initialState: ChatState = {
  conversations: [],
  activeId: null,
  isLoading: false,
  streamingContent: "",
  error: null,
  messagesLoading: false,
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
    setMessagesLoading(state, action: PayloadAction<boolean>) {
      state.messagesLoading = action.payload;
    },
    // Лениво подгруженные с сервера сообщения диалога.
    setConversationMessages(
      state,
      action: PayloadAction<{ id: string; messages: ChatMessage[] }>
    ) {
      const conv = state.conversations.find((c) => c.id === action.payload.id);
      if (conv) {
        conv.messages = action.payload.messages;
        conv.messagesLoaded = true;
      }
      state.messagesLoading = false;
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
    // Список диалогов с сервера (метаданными). Стартуем на пустом «новом чате»
    // (activeId=null) — сообщения тянутся лениво при открытии диалога. Это и
    // кросс-девайснее: на любом устройстве видишь свежий композер + всю историю.
    hydrate(state, action: PayloadAction<{ conversations: Conversation[] }>) {
      state.conversations = action.payload.conversations;
      state.activeId = null;
      state.hydrated = true;
    },
    // Помечаем загрузку завершённой, даже если список пуст / гость (hydrate тогда
    // не вызывается). Вызывается из загрузчика после ответа сервера.
    chatHydrated(state) {
      state.hydrated = true;
    },
    // Сброс при выходе из аккаунта / смене юзера. hydrated=true: известно пустое
    // состояние, сайдбар не должен залипать на скелетонах.
    resetChat() {
      return { ...initialState, hydrated: true };
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
  setMessagesLoading,
  setConversationMessages,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
  hydrate,
  chatHydrated,
  resetChat,
} = chatSlice.actions;

export default chatSlice.reducer;
