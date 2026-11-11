import { useEffect, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentChatSettings,
  AgentChatSettingsPatch,
  ReplyDraft,
} from "@timely/contract/agentChat";
import {
  chatRequest,
  deleteChat,
  getChatSettings,
  patchChatSettings,
  renameChat,
  type Chat,
  type ChatSummary,
} from "../api/chat";
import { apiFetch } from "../api/client";
import { ReplyDrafts, startChatStream } from "../api/chatStream";
import { isBusy } from "@/app/_components/chat/chatMeta";
export const chatsKey = ["chats"] as const;
export const chatKey = (id: string) => ["chat", id] as const;
// The chat stream (useChatStream) says when a chat changes. While it is down,
// chats are polled fast only while an Agent run works, since they only change
// on their own then. The slow check backs the stream up and catches runs
// started on another device; sending, approving and reading refetch at once.
const IDLE_POLL = 60_000;
let streaming = false;
export function useChats() {
  return useQuery({
    queryKey: chatsKey,
    queryFn: () => chatRequest<ChatSummary[]>(""),
    // Keeps going in a hidden window so a finished run still notifies.
    refetchInterval: (q) =>
      !streaming && q.state.data?.some((c) => isBusy(c.status))
        ? 5000
        : IDLE_POLL,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}
/** The replies live agent runs are writing, one per chat, in this tab. */
export const replyDrafts = new ReplyDrafts();

export function useChat(id?: string | null) {
  return useQuery({
    queryKey: chatKey(id || ""),
    queryFn: async () => {
      const chat = await chatRequest<Chat>(`/${encodeURIComponent(id || "")}`);
      // A late joiner, or the refetch after a missed chunk, continues here.
      replyDrafts.seed(chat.id, chat.activity);
      return chat;
    },
    enabled: !!id,
    refetchInterval: (q) =>
      !streaming && isBusy(q.state.data?.status) ? 1500 : IDLE_POLL,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}
/**
 * The reply a chat's live agent run has written so far, while the chat
 * still shows that run; the final reply replaces it as a normal message.
 */
export function useReplyDraft(chat: Chat | undefined): ReplyDraft | null {
  const id = chat?.id ?? "";
  const draft = useSyncExternalStore(
    (listener) => replyDrafts.subscribe(listener),
    () => (id ? replyDrafts.get(id) : null),
    () => null,
  );
  if (!chat || chat.runEngine !== "agent") return null;
  if (chat.status !== "running") return null;
  // Only the live run's draft: a row without its activity (a stopped run,
  // then a new message) must not bring the old cut-off text back.
  if (!draft || draft.run !== chat.activity?.run) return null;
  return draft?.text ? draft : null;
}

/** Keeps chats current from the live stream; mounted once, in ChatRuntime. */
export function useChatStream() {
  const cache = useQueryClient();
  useEffect(() => {
    const changed = new Set<string>();
    let all = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A run writes several times in a row; one refetch covers the burst.
    const flush = () => {
      timer = undefined;
      void cache.invalidateQueries({ queryKey: chatsKey });
      if (all) void cache.invalidateQueries({ queryKey: ["chat"] });
      else
        for (const id of changed)
          void cache.invalidateQueries({ queryKey: chatKey(id) });
      changed.clear();
      all = false;
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("timely-chat-stream");
    const stop = startChatStream(
      (message) => {
        if (message.type === "live") {
          if (streaming === message.live) return;
          // Refetching also re-times the polls, and catches up on a gap.
          streaming = message.live;
          all = true;
        } else if (message.type === "delta") {
          // A chunk past the draft's end means one was missed: refetch the
          // chat, whose activity.draft the draft continues from.
          if (!replyDrafts.delta(message)) return;
          changed.add(message.id);
        } else changed.add(message.id);
        timer ??= setTimeout(flush, 250);
      },
      {
        open: (signal) => apiFetch("/chats/watch", { signal }),
        locks: typeof navigator === "undefined" ? undefined : navigator.locks,
        channel,
      },
    );
    return () => {
      stop();
      clearTimeout(timer);
      streaming = false;
    };
  }, [cache]);
}
export function useRenameChat() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameChat(id, title),
    onSuccess: (next) => {
      cache.setQueryData(chatKey(next.id), next);
      cache.setQueryData<ChatSummary[]>(chatsKey, (list) =>
        list?.map((c) => (c.id === next.id ? { ...c, title: next.title } : c)),
      );
    },
  });
}
export function useDeleteChat() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: (_, id) => {
      cache.removeQueries({ queryKey: chatKey(id) });
      cache.setQueryData<ChatSummary[]>(chatsKey, (list) =>
        list?.filter((c) => c.id !== id),
      );
      void cache.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export const chatSettingsKey = ["agent-chat-settings"] as const;

/** Settings → Agent: the engine and the permission defaults. */
export function useChatSettings() {
  return useQuery({
    queryKey: chatSettingsKey,
    queryFn: getChatSettings,
    staleTime: 30_000,
  });
}

export function usePatchChatSettings() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (patch: AgentChatSettingsPatch) => patchChatSettings(patch),
    onMutate: async (patch) => {
      await cache.cancelQueries({ queryKey: chatSettingsKey });
      const before = cache.getQueryData<AgentChatSettings>(chatSettingsKey);
      if (before)
        cache.setQueryData<AgentChatSettings>(chatSettingsKey, {
          ...before,
          ...patch,
        });
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before) cache.setQueryData(chatSettingsKey, context.before);
    },
    onSuccess: (next) => cache.setQueryData(chatSettingsKey, next),
  });
}
