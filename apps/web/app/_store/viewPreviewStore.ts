"use client";

import { create } from "zustand";
import type { TaskViewConfig } from "@/app/_types/types";

/**
 * A view read from words in search, handed to Tasks [natural-language
 * views]. Tasks shows it as an unsaved Preview tab, or saves it straight
 * away when the person asked for a new view.
 */
export type PendingViewPreview = { view: TaskViewConfig; save: boolean };

type ViewPreviewState = {
  pending: PendingViewPreview | null;
  setPending: (pending: PendingViewPreview | null) => void;
};

export const useViewPreviewStore = create<ViewPreviewState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
