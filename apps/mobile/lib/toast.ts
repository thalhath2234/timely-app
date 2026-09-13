import { create } from "zustand";

type ToastAction = { label: string; onAction: () => void };

type ToastState = {
  message: string | null;
  action?: ToastAction;
  show: (message: string, action?: ToastAction) => void;
  hide: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  action: undefined,
  show: (message, action) => {
    if (timer) clearTimeout(timer);
    set({ message, action });
    timer = setTimeout(() => set({ message: null, action: undefined }), 5000);
  },
  hide: () => {
    if (timer) clearTimeout(timer);
    set({ message: null, action: undefined });
  },
}));

export function showUndoToast(message: string, onUndo?: () => void) {
  useToastStore.getState().show(
    message,
    onUndo ? { label: "Undo", onAction: onUndo } : undefined,
  );
}
