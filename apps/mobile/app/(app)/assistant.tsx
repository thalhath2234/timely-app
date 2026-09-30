import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAssistant } from "../../components/chat/AssistantProvider";
/** Notification deep links resolve into the global overlay after restoring the underlying screen. */
export default function AssistantLink() {
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const { open, hydrated } = useAssistant();
  const router = useRouter();
  useEffect(() => {
    if (!hydrated) return;
    if (router.canGoBack()) router.back(); else router.replace("/(app)/(tabs)/home");
    if (typeof chatId === "string") open(chatId);
  }, [chatId, hydrated]);
  return null;
}
