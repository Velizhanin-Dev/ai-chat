import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface IngestedDocument {
  id: string;
  source: string;
  speaker: string | null;
  chunksCount: number;
  createdAt: string;
}

interface IngestState {
  isUploading: boolean;
  progress: number;
  progressLabel: string;
  documents: IngestedDocument[];
  error: string | null;
}

const initialState: IngestState = {
  isUploading: false,
  progress: 0,
  progressLabel: "",
  documents: [],
  error: null,
};

const ingestSlice = createSlice({
  name: "ingest",
  initialState,
  reducers: {
    setUploading(state, action: PayloadAction<boolean>) {
      state.isUploading = action.payload;
    },
    setProgress(
      state,
      action: PayloadAction<{ value: number; label: string }>
    ) {
      state.progress = action.payload.value;
      state.progressLabel = action.payload.label;
    },
    addDocument(state, action: PayloadAction<IngestedDocument>) {
      state.documents.unshift(action.payload);
    },
    setDocuments(state, action: PayloadAction<IngestedDocument[]>) {
      state.documents = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    resetProgress(state) {
      state.progress = 0;
      state.progressLabel = "";
      state.isUploading = false;
    },
  },
});

export const {
  setUploading,
  setProgress,
  addDocument,
  setDocuments,
  setError,
  resetProgress,
} = ingestSlice.actions;

export default ingestSlice.reducer;
