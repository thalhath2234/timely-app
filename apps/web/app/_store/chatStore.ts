"use client";
import { create } from "zustand";
import type { ChatContext } from "../utils/api/chat";
type State = {
  open: boolean;
  conversationId: string | null;
  context: ChatContext[];
  /** Chats sent from the quick prompt that the Activity island keeps until
   * the person opens or dismisses them. */
  tracked: string[];
  /** Chats dismissed from the island, by the revision they had then; a newer
   * revision brings them back. */
  dismissed: Record<string, number>;
  openNew: (context: ChatContext[]) => void;
  openChat: (id: string) => void;
  setId: (id: string) => void;
  close: () => void;
  track: (id: string) => void;
  untrack: (id: string) => void;
  dismiss: (id: string, revision: number) => void;
};
export const useChatStore = create<State>((set) => ({
  open: false,
  conversationId: null,
  context: [],
  tracked: [],
  dismissed: {},
  openNew: (context) => set({ open: true, conversationId: null, context }),
  openChat: (conversationId) =>
    set({ open: true, conversationId, context: [] }),
  setId: (conversationId) => set({ conversationId }),
  close: () => set({ open: false }),
  track: (id) =>
    set((s) => ({
      tracked: s.tracked.includes(id) ? s.tracked : [id, ...s.tracked],
    })),
  untrack: (id) => set((s) => ({ tracked: s.tracked.filter((t) => t !== id) })),
  dismiss: (id, revision) =>
    set((s) => ({
      tracked: s.tracked.filter((t) => t !== id),
      dismissed: { ...s.dismissed, [id]: revision },
    })),
}));
