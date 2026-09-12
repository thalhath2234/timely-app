"use client";

import { create } from "zustand";

export type ToastAction = {
  label: string;
  onAction: () => void;
};

export type ToastItem = {
  id: string;
  message: string;
  action?: ToastAction;
};

type ToastState = {
  toasts: ToastItem[];
  show: (message: string, action?: ToastAction, durationMs?: number) => string;
  dismiss: (id: string) => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, action, durationMs = 6000) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, action }] }));
    const timer = setTimeout(() => get().dismiss(id), durationMs);
    timers.set(id, timer);
    return id;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export function showUndoToast(message: string, onUndo?: () => void) {
  return useToastStore.getState().show(
    message,
    onUndo ? { label: "Undo", onAction: onUndo } : undefined,
  );
}
