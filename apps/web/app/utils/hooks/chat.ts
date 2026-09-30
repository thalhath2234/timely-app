import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chatRequest,
  deleteChat,
  renameChat,
  type Chat,
  type ChatSummary,
} from "../api/chat";
export const chatsKey = ["chats"] as const;
export const chatKey = (id: string) => ["chat", id] as const;
export function useChats() {
  return useQuery({
    queryKey: chatsKey,
    queryFn: () => chatRequest<ChatSummary[]>(""),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
}
export function useChat(id?: string | null) {
  return useQuery({
    queryKey: chatKey(id || ""),
    queryFn: () => chatRequest<Chat>(`/${encodeURIComponent(id || "")}`),
    enabled: !!id,
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.status || "") ? 1500 : 5000,
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
