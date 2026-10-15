import { createContext, useContext, useEffect, useRef } from "react";
import { useNavigation } from "expo-router";
import type { AssistantCache } from "./storage";
import type { AssistantDraft, ChatContext } from "./types";
export type ScreenRegistration = {
  chips: ChatContext[];
  pinchZoom?: boolean;
  /** Asked at the moment of a pinch, so it never goes stale mid-navigation. */
  isFocused: () => boolean;
};
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
  register: (owner: object, data: ScreenRegistration | null) => void;
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
/**
 * Screens publish local view state; the provider captures it only on explicit
 * invocation, from whichever screen navigation says is focused then. Not keyed
 * by `usePathname()`: that is the app's path, not the screen's,
 * so a tab left behind could file its chips under the next screen's path.
 */
export function useAssistantScreen(
  chips: ChatContext[],
  options: { pinchZoom?: boolean } = {},
) {
  const { register } = useAssistant();
  const navigation = useNavigation();
  const owner = useRef({}).current;
  const serialized = JSON.stringify(chips);
  useEffect(() => {
    register(owner, {
      chips: JSON.parse(serialized),
      pinchZoom: options.pinchZoom,
      isFocused: () => navigation.isFocused(),
    });
  }, [serialized, options.pinchZoom, navigation, register, owner]);
  useEffect(() => () => register(owner, null), [register, owner]);
}
