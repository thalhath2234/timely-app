import { create } from "zustand";
import type { TaskViewConfig } from "./types";

/**
 * A view read from words in Search [natural-language views], shown on the
 * Tasks tab as an unsaved Preview until it is saved or closed.
 */
type ViewPreviewState = {
  preview: TaskViewConfig | null;
  setPreview: (preview: TaskViewConfig | null) => void;
  patchPreview: (patch: Partial<TaskViewConfig>) => void;
  /** A view Search asked to save; the Tasks tab saves it with its views. */
  pendingSave: TaskViewConfig | null;
  setPendingSave: (view: TaskViewConfig | null) => void;
};

export const PREVIEW_VIEW_ID = "preview";

export const useViewPreviewStore = create<ViewPreviewState>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview: preview ? { ...preview, id: PREVIEW_VIEW_ID } : null }),
  patchPreview: (patch) => set((state) => (state.preview ? { preview: { ...state.preview, ...patch } } : state)),
  pendingSave: null,
  setPendingSave: (pendingSave) => set({ pendingSave }),
}));
