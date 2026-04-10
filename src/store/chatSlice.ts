import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  sessionId: string;
  isLoading: boolean;
  streamingContent: string;
  error: string | null;
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
} = chatSlice.actions;

export default chatSlice.reducer;
