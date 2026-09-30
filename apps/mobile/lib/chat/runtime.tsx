import { createContext, useContext, useCallback } from "react";
import { useFocusEffect, usePathname } from "expo-router";
import type { AssistantCache } from "./storage";
import type { AssistantDraft, ChatContext } from "./types";
export type ScreenRegistration = { chips: ChatContext[]; pinchZoom?: boolean };
export type AssistantState = {
  visible: boolean;
  chatId: string | null;
  foreground: boolean;
  cache: AssistantCache;
  hydrated: boolean;
  updateCache: (update: (cache: AssistantCache) => AssistantCache) => void;
  setDraft: (update: (draft: AssistantDraft) => AssistantDraft) => void;
  open: (id?: string) => void;
  close: () => void;
  select: (id: string | null) => void;
  acceptSend: (previousId: string | null, nextId: string) => void;
  setBackHandler: (handler: (() => void) | null) => void;
  currentContext: () => ChatContext[];
  screenshot: () => Promise<string>;
  openResult: (href: string) => void;
  register: (path: string, data: ScreenRegistration | null) => void;
};
export const Context = createContext<AssistantState | null>(null);
export const emptyDraft = (context: ChatContext[] = []): AssistantDraft => ({
  text: "",
  context,
  webSearch: false,
  images: [],
});

export function useAssistant() {
  const state = useContext(Context);
  if (!state) throw new Error("AssistantProvider is required");
  return state;
}
/** Screens publish local view state; the provider captures it only on explicit invocation. */
export function useAssistantScreen(
  chips: ChatContext[],
  options: { pinchZoom?: boolean } = {},
) {
  const { register } = useAssistant();
  const path = usePathname();
  const serialized = JSON.stringify(chips);
  useFocusEffect(
    useCallback(() => {
      register(path, {
        chips: JSON.parse(serialized),
        pinchZoom: options.pinchZoom,
      });
      return () => register(path, null);
    }, [path, serialized, options.pinchZoom, register]),
  );
}
