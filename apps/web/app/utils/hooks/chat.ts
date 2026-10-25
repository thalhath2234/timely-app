import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chatRequest,
  deleteChat,
  renameChat,
  type Chat,
  type ChatSummary,
} from "../api/chat";
import { isBusy } from "@/app/_components/chat/chatMeta";
export const chatsKey = ["chats"] as const;
export const chatKey = (id: string) => ["chat", id] as const;
// Chats only change on their own while an Agent run works, so polling is fast
// only then. The slow check catches runs started on another device; sending,
// approving and reading here refetch straight away.
const IDLE_POLL = 60_000;
export function useChats() {
  return useQuery({
    queryKey: chatsKey,
    queryFn: () => chatRequest<ChatSummary[]>(""),
    // Keeps going in a hidden window so a finished run still notifies.
    refetchInterval: (q) =>
      q.state.data?.some((c) => isBusy(c.status)) ? 5000 : IDLE_POLL,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}
export function useChat(id?: string | null) {
  return useQuery({
    queryKey: chatKey(id || ""),
    queryFn: () => chatRequest<Chat>(`/${encodeURIComponent(id || "")}`),
    enabled: !!id,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1500 : IDLE_POLL),
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
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
