import { useQuery } from "@tanstack/react-query";
import { chatRequest, type Chat } from "../api/chat";
export const chatsKey = ["chats"] as const;
export const chatKey = (id: string) => ["chat", id] as const;
export function useChats() {
  return useQuery({
    queryKey: chatsKey,
    queryFn: () => chatRequest<Chat[]>(""),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
}
export function useChat(id?: string | null) {
  return useQuery({
    queryKey: chatKey(id || ""),
    queryFn: () => chatRequest<Chat>(`/${id}`),
    enabled: !!id,
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.status || "") ? 1500 : 5000,
  });
}
