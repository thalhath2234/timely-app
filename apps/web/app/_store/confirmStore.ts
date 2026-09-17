"use client";

import { create } from "zustand";
import { runViewTransition } from "@/app/utils/viewTransition";

export type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  onConfirm: () => void | Promise<void>;
};

type ConfirmState = {
  request: (ConfirmRequest & { id: number }) | null;
  pending: boolean;
  ask: (request: ConfirmRequest) => void;
  cancel: () => void;
  setPending: (pending: boolean) => void;
};

let nextId = 0;

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  pending: false,
  ask: (request) => {
    nextId += 1;
    runViewTransition(() =>
      set({ request: { ...request, id: nextId }, pending: false }),
    );
  },
  cancel: () => runViewTransition(() => set({ request: null, pending: false })),
  setPending: (pending) => set({ pending }),
}));

/** Destructive menu actions live outside any component that could host a
 * dialog, so they raise the confirmation through this store instead. */
export function requestConfirm(request: ConfirmRequest) {
  useConfirmStore.getState().ask(request);
}
