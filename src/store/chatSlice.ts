import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type ChatModel = "fast" | "smart";

interface ChatState {
  messages: ChatMessage[];
  sessionId: string;
  isLoading: boolean;
  streamingContent: string;
  error: string | null;
  model: ChatModel;
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const initialState: ChatState = {
  messages: [],
  sessionId: generateSessionId(),
  isLoading: false,
  streamingContent: "",
  error: null,
  model: "fast",
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    addMessage(state, action: PayloadAction<ChatMessage>) {
      state.messages.push(action.payload);
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
    resetChat(state) {
      state.messages = [];
      state.sessionId = generateSessionId();
      state.isLoading = false;
      state.streamingContent = "";
      state.error = null;
    },
    setMessages(state, action: PayloadAction<ChatMessage[]>) {
      state.messages = action.payload;
    },
    setSessionId(state, action: PayloadAction<string>) {
      state.sessionId = action.payload;
    },
    setModel(state, action: PayloadAction<ChatModel>) {
      state.model = action.payload;
    },
    hydrate(
      state,
      action: PayloadAction<{
        messages: ChatMessage[];
        sessionId: string;
        model?: ChatModel;
      }>
    ) {
      state.messages = action.payload.messages;
      state.sessionId = action.payload.sessionId;
      if (action.payload.model) state.model = action.payload.model;
    },
  },
});

export const {
  addMessage,
  setLoading,
  setStreamingContent,
  appendStreamingContent,
  finalizeStreaming,
  setError,
  resetChat,
  setMessages,
  setSessionId,
  setModel,
  hydrate,
} = chatSlice.actions;

export default chatSlice.reducer;
