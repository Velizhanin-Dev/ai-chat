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
  // Идёт заполнение брифа нового проекта (1 проект = 1 диалог). Пока true —
  // вместо окна чата справа показываем визард брифа (см. chat/page).
  drafting: boolean;
  // Стрим/ошибка относятся к активному диалогу (одновременно генерируется один).
  isLoading: boolean;
  streamingContent: string;
  error: string | null;
  // Идёт ленивая подгрузка сообщений открытого диалога с сервера.
  messagesLoading: boolean;
  // Тик-сигнал «поставь фокус в поле ввода» (растёт при «Новый чат»). UI-only,
  // не персистится — ChatInput фокусирует textarea при изменении значения.
  inputFocusSignal: number;
  // Подстановка текста в поле ввода извне (плитки стартового экрана «что я умею»).
  // seq растёт на каждый клик — иначе повторный клик по той же плитке не сработал бы.
  prefill: { text: string; seq: number };
  // Завершена ли загрузка списка диалогов с сервера. Пока false — сайдбар
  // показывает скелетоны вместо «Пока нет диалогов» (иначе мелькает ложное «пусто»).
  hydrated: boolean;
}

const DEFAULT_TITLE = "Новый проект";

// Новый клиентский id проекта (диалога) — генерит клиент, отправляет на сервер
// при создании проекта (POST /api/conversations) и в /api/chat.
export function newProjectId(): string {
  return nanoid();
}

const initialState: ChatState = {
  conversations: [],
  activeId: null,
  drafting: false,
  isLoading: false,
  streamingContent: "",
  error: null,
  messagesLoading: false,
  inputFocusSignal: 0,
  prefill: { text: "", seq: 0 },
  hydrated: false,
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    // Создан проект (после прохождения брифа, см. POST /api/conversations). Кладём
    // в список и делаем активным; drafting НЕ сбрасываем — визард ещё покажет
    // экран результата (тип харизмы), после «Поехали» вызовется finishBriefing.
    addProject(state, action: PayloadAction<Conversation>) {
      state.conversations.unshift(action.payload);
      state.activeId = action.payload.id;
      state.streamingContent = "";
      state.error = null;
    },
    setActiveConversation(state, action: PayloadAction<string>) {
      if (state.conversations.some((c) => c.id === action.payload)) {
        state.activeId = action.payload;
        state.drafting = false;
        state.streamingContent = "";
        state.error = null;
      }
    },
    // «Новый проект»: входим в режим брифа (диалог создастся после его прохождения).
    startBriefing(state) {
      state.activeId = null;
      state.drafting = true;
      state.streamingContent = "";
      state.error = null;
    },
    // Бриф пройден и подтверждён («Поехали в чат») → выходим из режима брифа к чату.
    finishBriefing(state) {
      state.drafting = false;
      state.inputFocusSignal += 1;
    },
    deleteConversation(state, action: PayloadAction<string>) {
      state.conversations = state.conversations.filter((c) => c.id !== action.payload);
      if (state.activeId === action.payload) {
        // Уходим в пустое состояние, а не в соседний проект.
        state.activeId = null;
        state.drafting = false;
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
      // Заголовок проекта берётся из брифа (название канала) при создании, по
      // первому сообщению его больше НЕ переопределяем (ушли от summary-заголовков).
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    // Подставить текст в композер и сфокусировать. Зовётся и с уже открытого чата
    // (плитки, быстрые действия), и ИЗ ДРУГИХ РАЗДЕЛОВ перед переходом в чат
    // (дорожная карта, «Сгенерировать сценарий» в контент-плане).
    prefillInput(state, action: PayloadAction<string>) {
      state.prefill = { text: action.payload, seq: state.prefill.seq + 1 };
    },
    // Композер забрал текст. ⚠️ Обязательный шаг: реагировать только на рост seq
    // нельзя — при переходе из другого раздела prefill ставится ДО монтирования
    // ChatInput, и тот видит уже новый seq как «начальный» (текст терялся).
    // Поэтому потребитель гасит текст, а не сравнивает счётчики.
    prefillConsumed(state) {
      state.prefill = { text: "", seq: state.prefill.seq };
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
      state.drafting = false;
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
  addProject,
  setActiveConversation,
  startBriefing,
  finishBriefing,
  deleteConversation,
  renameConversation,
  addMessage,
  setLoading,
  prefillInput,
  prefillConsumed,
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
