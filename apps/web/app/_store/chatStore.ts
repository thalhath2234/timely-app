"use client";
import { create } from "zustand";
import type { ChatContext } from "../utils/api/chat";
type State = {
  open: boolean;
  conversationId: string | null;
  context: ChatContext[];
  openNew: (context: ChatContext[]) => void;
  setId: (id: string) => void;
  close: () => void;
};
export const useChatStore = create<State>((set) => ({
  open: false,
  conversationId: null,
  context: [],
  openNew: (context) => set({ open: true, conversationId: null, context }),
  setId: (conversationId) => set({ conversationId }),
  close: () => set({ open: false }),
}));
