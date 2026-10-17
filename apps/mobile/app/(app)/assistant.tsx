import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAssistant } from "../../components/chat/AssistantProvider";
/**
 * Notification links (with a chatId) and the Ask shortcut or widget button
 * (without one, for a fresh chat) resolve into the global overlay after
 * restoring the underlying screen.
 */
export default function AssistantLink() {
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const { open, hydrated } = useAssistant();
  const router = useRouter();
  useEffect(() => {
    if (!hydrated) return;
    if (router.canGoBack()) router.back(); else router.replace("/(app)/(tabs)/home");
    open(typeof chatId === "string" ? chatId : undefined);
  }, [chatId, hydrated]);
  return null;
}
