import { create } from "zustand";

interface AppState {
  // Currently selected detection
  selectedDetectionId: string | null;
  setSelectedDetectionId: (id: string | null) => void;

  // Active tab
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // API key
  apiKey: string;
  setApiKey: (key: string) => void;

  // Global Gemini model override for run execution
  selectedModel: string;
  setSelectedModel: (model: string) => void;

  // Selected run context (persisted while app is open)
  selectedRunByDetection: Record<string, string>;
  setSelectedRunForDetection: (detectionId: string, runId: string) => void;
  clearSelectedRunForDetection: (detectionId: string) => void;

  // Refresh triggers
  refreshCounter: number;
  triggerRefresh: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedDetectionId: null,
  setSelectedDetectionId: (id) => set({ selectedDetectionId: id }),

  activeTab: 0,
  setActiveTab: (tab) => set({ activeTab: tab }),

  apiKey: "",
  setApiKey: (key) => set({ apiKey: key }),

  selectedModel: "gemini-2.5-flash",
  setSelectedModel: (model) => set({ selectedModel: model }),

  selectedRunByDetection: {},
  setSelectedRunForDetection: (detectionId, runId) =>
    set((state) => ({
      selectedRunByDetection: {
        ...state.selectedRunByDetection,
        [detectionId]: runId,
      },
    })),
  clearSelectedRunForDetection: (detectionId) =>
    set((state) => {
      const next = { ...state.selectedRunByDetection };
      delete next[detectionId];
      return { selectedRunByDetection: next };
    }),

  refreshCounter: 0,
  triggerRefresh: () => set((s) => ({ refreshCounter: s.refreshCounter + 1 })),
}));
