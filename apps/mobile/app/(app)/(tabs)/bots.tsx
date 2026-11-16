import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { ASSISTANT_ROUTE, legacyAssistantRoute } from "../../../lib/notificationRoute";

/**
 * The old Bots tab. Bots now live in the Assistant tab with the chats, so
 * every old link (`/bots?bot=<id>`, `?new=1&starter=<id>`, a notification, a
 * live block) lands there with its Bot or Starter kept.
 */
export default function BotsRedirect() {
  const params = useLocalSearchParams<{ bot?: string; thread?: string; new?: string; starter?: string }>();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" && value) search.set(key, value);
  return <Redirect href={(legacyAssistantRoute("/bots", search.toString()) ?? ASSISTANT_ROUTE) as Href} />;
}
