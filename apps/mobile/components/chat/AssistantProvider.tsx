import {
  Context,
  emptyDraft,
  type AssistantState,
  type ScreenRegistration,
} from "../../lib/chat/runtime";
export { useAssistant, useAssistantScreen } from "../../lib/chat/runtime";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AppState, Keyboard, Modal, Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import {
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  useRouter,
  type Href,
} from "expo-router";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { captureRef } from "react-native-view-shot";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../lib/auth/AuthProvider";
import {
  clearAssistantCache,
  loadAssistantCache,
  saveAssistantCache,
  type AssistantCache,
} from "../../lib/chat/storage";
import {
  contextChip,
  mergeContext,
  routeContext,
  routeObject,
} from "../../lib/chat/context";
import type { AssistantDraft, ChatContext } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import Assistant from "./Assistant";
import { Action } from "./shared";

const emptyCache = (): AssistantCache => ({
  receiptEdits: {},
  draft: null,
  chats: [],
  conversations: {},
  hintDismissed: false,
});

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const uid = user?.id;
  const path = usePathname();
  const navigationState = useRootNavigationState();
  const navigationKey = JSON.stringify(navigationState, (key, value) =>
    ["key", "index", "routes", "state", "name", ""].includes(key) ||
    /^\d+$/.test(key)
      ? value
      : undefined,
  );
  const params = useGlobalSearchParams();
  const router = useRouter();
  const query = useQueryClient();
  const root = useRef<View>(null);
  const screens = useRef(new Map<string, ScreenRegistration>());
  const [visible, setVisible] = useState(false);
  const backHandler = useRef<(() => void) | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [hydratedUser, setHydratedUser] = useState<string>();
  const [cache, setCache] = useState<AssistantCache>(emptyCache);
  chatIdRef.current = chatId;
  const account = useRef(uid);
  account.current = uid;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const returnTo = useRef<{
    path: string;
    navigationKey: string;
    id: string | null;
    departed: boolean;
  } | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    returnTo.current = null;
    backHandler.current = null;
    setVisible(false);
    setChatId(null);
    setCache(emptyCache());
    setHydratedUser(undefined);
    if (!uid) return;
    let active = true;
    void loadAssistantCache(uid).then((value) => {
      if (active) {
        setCache(value);
        setHydratedUser(uid);
      }
    });
    return () => {
      active = false;
    };
  }, [uid]);
  useEffect(() => {
    if (uid && hydratedUser === uid)
      void saveAssistantCache(uid, cache).catch(() => undefined);
  }, [uid, hydratedUser, cache]);
  const previousUser = useRef(uid);
  useEffect(() => {
    if (previousUser.current && !uid)
      void clearAssistantCache(previousUser.current).catch(() => undefined);
    previousUser.current = uid;
  }, [uid]);
  useEffect(() => {
    const target = returnTo.current;
    if (!target) return;
    if (navigationKey !== target.navigationKey) target.departed = true;
    else if (target.departed) {
      setChatId(target.id);
      setVisible(true);
      returnTo.current = null;
    }
  }, [path, navigationKey]);

  const register = useCallback(
    (location: string, data: ScreenRegistration | null) => {
      if (data) screens.current.set(location, data);
      else screens.current.delete(location);
    },
    [],
  );
  const currentContext = () => {
    const match = routeObject(path);
    const key = match
      ? [
          (
            {
              tasks: "task",
              docs: "docs",
              sheets: "sheets",
              projects: "projects",
              events: "event",
            } as Record<string, string>
          )[match[0]],
          match[1],
        ]
      : null;
    const entity = key
      ? query.getQueryData<{
          title?: string;
          workspaceId?: string;
          projectId?: string;
        }>(key)
      : undefined;
    const registered = screens.current.get(path)?.chips;
    return mergeContext(
      [],
      registered
        ? [contextChip("location", "Current screen", path), ...registered]
        : routeContext(path, params, entity),
    );
  };
  const open = (id?: string) => {
    if (!uid || !token || hydratedUser !== uid) return;
    returnTo.current = null;
    Keyboard.dismiss();
    if (id) setChatId(id);
    else {
      try {
        if (!cacheRef.current.draft)
          setCache((value) => ({
            ...value,
            draft: emptyDraft(currentContext()),
          }));
        setChatId(cacheRef.current.draft?.conversationId ?? null);
      } catch (error) {
        Alert.alert("Screen context", String((error as Error).message));
        return;
      }
    }
    setVisible(true);
  };
  const gestureTriggered = useRef(false);
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .enabled(Boolean(uid && token && hydratedUser === uid && !visible))
    .onBegin(() => {
      gestureTriggered.current = false;
    })
    .onUpdate((event) => {
      if (
        event.numberOfPointers === 2 &&
        event.scale <= 0.78 &&
        !gestureTriggered.current &&
        !screens.current.get(path)?.pinchZoom
      ) {
        gestureTriggered.current = true;
        open();
      }
    });
  const state: AssistantState = {
    visible,
    chatId,
    foreground,
    hydrated: hydratedUser === uid && !!uid,
    cache,
    updateCache: (update) => {
      if (account.current === uid) setCache(update);
    },
    setDraft: (update) => {
      if (account.current === uid)
        setCache((value) => ({
          ...value,
          draft: update(value.draft ?? emptyDraft()),
        }));
    },
    open,
    close: () => {
      Keyboard.dismiss();
      setVisible(false);
    },
    select: (id) => {
      setChatId(id);
      setVisible(true);
    },
    acceptSend: (previousId, nextId) => {
      if (account.current === uid && chatIdRef.current === previousId)
        setChatId(nextId);
    },
    setBackHandler: (handler) => {
      backHandler.current = handler;
    },
    currentContext,
    register,
    screenshot: async () => {
      Keyboard.dismiss();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return captureRef(root, { format: "png", result: "tmpfile" });
    },
    openResult: (href) => {
      returnTo.current = { path, navigationKey, id: chatId, departed: false };
      setVisible(false);
      router.push(href as Href);
    },
  };
  return (
    <Context.Provider value={state}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={pinch}>
          <View ref={root} collapsable={false} style={{ flex: 1 }}>
            {children}
          </View>
        </GestureDetector>
        {uid && hydratedUser === uid && !cache.hintDismissed && !visible ? (
          <View style={styles.hint}>
            <View style={styles.hintIcon}>
              <Sparkles size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.hintTitle}>Meet your assistant</Text>
              <Text style={styles.hintText}>
                Pinch inward with two fingers to ask about this screen.
              </Text>
            </View>
            <Action
              label="Got it"
              compact
              onPress={() =>
                setCache((value) => ({ ...value, hintDismissed: true }))
              }
            />
          </View>
        ) : null}
        <Modal
          visible={visible && !!uid && hydratedUser === uid}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => {
            if (backHandler.current) backHandler.current();
            else state.close();
          }}
        >
          <GestureHandlerRootView style={{ flex: 1 }}>
            {uid && hydratedUser === uid ? <Assistant key={uid} /> : null}
          </GestureHandlerRootView>
        </Modal>
      </GestureHandlerRootView>
    </Context.Provider>
  );
}
const styles = createThemedStyleSheet(() => ({
  hint: {
    position: "absolute",
    bottom: 110,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  hintIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  hintTitle: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  hintText: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
}));
