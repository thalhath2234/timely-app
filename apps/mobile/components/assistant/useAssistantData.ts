import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BotView } from "@timely/contract/bots";
import { useAuth } from "../../lib/auth/AuthProvider";
import { chatRequest, getBotThread, listBotThreads, type BotThreadSummary, type BotThreadView } from "../../lib/api/chat";
import { isOffline } from "../../lib/networkState";
import { useBotsQuery } from "../../lib/hooks";
import type { Chat } from "../../lib/chat/types";
import { buildInbox, type Inbox, type InboxChat } from "./inbox";

const POLL = 15_000;

/** Same key as the chat overlay's list, so both read one cache. */
export const chatListKey = (uid: string | undefined) => ["chats", uid] as const;
export const botThreadsKey = ["bot-threads"] as const;
export const botThreadKey = (id: string) => ["bot-thread", id] as const;

/** The chats (GET /chats leaves out Bot threads and new-Bot drafts). */
export function useChatList(enabled = true) {
  const uid = useAuth().user?.id;
  return useQuery({
    queryKey: chatListKey(uid),
    queryFn: () => chatRequest<Chat[]>(""),
    enabled: enabled && !!uid && !isOffline(),
    refetchInterval: POLL,
    staleTime: 5000,
  });
}

/** Every Bot thread and new-Bot draft, with why each needs the person. */
export function useBotThreads(enabled = true) {
  const uid = useAuth().user?.id;
  return useQuery({
    queryKey: [...botThreadsKey, uid],
    queryFn: listBotThreads,
    enabled: enabled && !!uid && !isOffline(),
    refetchInterval: POLL,
    staleTime: 5000,
  });
}

/** One Bot's thread (by the Bot's id, made on first ask) or a draft thread (by its own id). */
export function useBotThread(id: string | null | undefined, live = true) {
  return useQuery({
    queryKey: botThreadKey(id ?? ""),
    queryFn: () => getBotThread(id ?? ""),
    enabled: !!id,
    staleTime: 0,
    // While the Bot's turn runs the reply is on its way.
    refetchInterval: (query) => (!live ? false : (query.state.data as BotThreadView | undefined)?.summary.status === "running" ? 1500 : 6000),
  });
}

/** The inbox and the pieces it was built from. */
export function useInbox(now: Date): {
  inbox: Inbox;
  bots: BotView[] | undefined;
  chats: Chat[] | undefined;
  threads: BotThreadSummary[] | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
} {
  const bots = useBotsQuery();
  const chats = useChatList();
  const threads = useBotThreads();
  const minute = Math.floor(now.getTime() / 60_000);
  const inbox = useMemo(
    () => buildInbox((chats.data ?? []) as InboxChat[], bots.data?.bots ?? [], threads.data ?? [], new Date(minute * 60_000)),
    [chats.data, bots.data, threads.data, minute],
  );
  return {
    inbox,
    bots: bots.data?.bots,
    chats: chats.data,
    threads: threads.data,
    loading: (bots.isPending || chats.isPending) && !bots.data && !chats.data,
    error: (bots.error as Error | null) ?? (chats.error as Error | null),
    refetch: () => Promise.all([bots.refetch(), chats.refetch(), threads.refetch()]),
  };
}

/** How many inbox rows wait on the person: the Assistant tab's badge. */
export function useAssistantNeedsCount(): number {
  const bots = useBotsQuery();
  const chats = useChatList();
  const threads = useBotThreads();
  const minute = Math.floor(Date.now() / 60_000);
  return useMemo(
    () => buildInbox((chats.data ?? []) as InboxChat[], bots.data?.bots ?? [], threads.data ?? [], new Date(minute * 60_000)).needs.length,
    [chats.data, bots.data, threads.data, minute],
  );
}

/** Refreshes the lists and one thread after a change. */
export function useRefreshAssistant() {
  const client = useQueryClient();
  return (threadId?: string) => {
    void client.invalidateQueries({ queryKey: ["bots"] });
    void client.invalidateQueries({ queryKey: botThreadsKey });
    void client.invalidateQueries({ queryKey: ["chats"] });
    if (threadId) void client.invalidateQueries({ queryKey: botThreadKey(threadId) });
  };
}
