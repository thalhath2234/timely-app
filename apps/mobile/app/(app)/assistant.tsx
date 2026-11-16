import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { ASSISTANT_ROUTE, assistantTabRoute, legacyAssistantRoute } from "../../lib/notificationRoute";

/**
 * Old assistant links land in the Assistant tab: a notification or widget
 * with a chat (`?chatId=<id>` or `?chat=<id>`) opens that chat there, a Bot
 * link keeps its Bot, and the Ask shortcut or widget button (no chat) asks
 * the tab for a fresh chat.
 */
export default function AssistantLink() {
  const params = useLocalSearchParams<{ chatId?: string; chat?: string; id?: string; bot?: string; thread?: string; new?: string; starter?: string }>();
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const chat = text(params.chatId) ?? text(params.chat) ?? text(params.id);
  if (chat) return <Redirect href={(legacyAssistantRoute("/chat", new URLSearchParams({ id: chat }).toString()) ?? ASSISTANT_ROUTE) as Href} />;
  const search = new URLSearchParams();
  for (const key of ["bot", "thread", "new", "starter"] as const) {
    const value = text(params[key]);
    if (value) search.set(key, value);
  }
  if (search.size) return <Redirect href={(legacyAssistantRoute("/bots", search.toString()) ?? ASSISTANT_ROUTE) as Href} />;
  return <Redirect href={assistantTabRoute("/assistant?ask=1") as Href} />;
}
