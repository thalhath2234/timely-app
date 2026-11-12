import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { watchChats } from "../api/chatStream";
import { keys } from "../hooks";

/**
 * While a "What Timely learned" screen is in front, follows `GET /chats/watch`
 * and refetches every learning list on each `learning` frame (any chat, or
 * none), so the screen follows what the agent learns, stages or undoes.
 */
export function useLearningWatch() {
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      watchChats((message) => {
        if (message.type === "learning") void client.invalidateQueries({ queryKey: keys.agentLearning });
      }, controller.signal);
      return () => controller.abort();
    }, [client]),
  );
}
