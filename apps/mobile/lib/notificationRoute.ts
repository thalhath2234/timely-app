import { legacyToAssistant, notificationToAssistant } from "@timely/contract/assistant";

// Same as fileHref in ./fileRoutes. Inlined because this module stays free of
// runtime imports (the contract's pure Assistant routes aside) so
// `make test-mobile-assistant` can load it with plain Node.
function filePath(id: string) {
  return `/(app)/files/${encodeURIComponent(id)}`;
}

function dataString(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value ? value : null;
}

export const NOTIFICATIONS_ROUTE = "/(app)/notifications";
/** The Assistant tab: chats and Bots in one inbox. */
export const ASSISTANT_ROUTE = "/(app)/(tabs)/assistant";
/** The old Bots tab; it redirects into the Assistant tab. */
export const BOTS_ROUTE = "/(app)/(tabs)/bots";

/**
 * An Assistant link from the contract (`/assistant?chat=..`) as the phone's
 * route to the tab. `thread` adds `thread=1` so a Bot opens on its own thread.
 */
export function assistantTabRoute(href: string, opts: { thread?: boolean } = {}): string {
  const query = href.includes("?") ? href.slice(href.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  if (opts.thread && params.get("bot") && !params.get("thread")) params.set("thread", "1");
  const text = params.toString();
  return text ? `${ASSISTANT_ROUTE}?${text}` : ASSISTANT_ROUTE;
}

/** Where the old /chat or /bots screens now land on the phone, or null for any other path. */
export function legacyAssistantRoute(pathname: string, search = ""): string | null {
  const href = legacyToAssistant(pathname, search);
  return href === null ? null : assistantTabRoute(href);
}

export function routeForNotification(data: Record<string, unknown>): string {
  // A chat notification opens its chat; a Bot alert opens that Bot's thread
  // (the Assistant when it names no Bot).
  const target = notificationToAssistant({
    category: dataString(data, "category") ?? undefined,
    entityType: dataString(data, "entityType") ?? undefined,
    entityId: dataString(data, "entityId") ?? undefined,
    chatId: dataString(data, "chatId") ?? undefined,
    botId: dataString(data, "botId") ?? undefined,
    data,
  });
  if (target) return assistantTabRoute(target, { thread: true });
  // A smart alert about waiting Inbox items opens the Inbox, not one item.
  if (dataString(data, "category") === "suggestion" && dataString(data, "kind") === "inbox") return "/(app)/inbox";
  const taskId = dataString(data, "taskId");
  if (taskId) return `/(app)/tasks/${taskId}`;

  const entityType = dataString(data, "entityType");
  const entityId = dataString(data, "entityId");
  if (entityType && entityId) {
    if (entityType === "task") return `/(app)/tasks/${entityId}`;
    if (entityType === "project") return `/(app)/projects/${entityId}`;
    if (entityType === "doc" || entityType === "sheet")
      return filePath(entityId);
    if (entityType === "event") return `/(app)/events/${entityId}`;
  }

  const entityRoutes: [string, (id: string) => string][] = [
    ["projectId", (id) => `/(app)/projects/${id}`],
    ["docId", filePath],
    ["sheetId", filePath],
    ["eventId", (id) => `/(app)/events/${id}`],
  ];
  for (const [key, route] of entityRoutes) {
    const id = dataString(data, key);
    if (id) return route(id);
  }

  // A smart alert about several tasks opens the first one, as on the web.
  if (dataString(data, "category") === "suggestion") {
    const ids = data.taskIds;
    const first = Array.isArray(ids) ? ids.find((id): id is string => typeof id === "string" && id !== "") : undefined;
    if (first) return `/(app)/tasks/${first}`;
  }

  const category = dataString(data, "category") ?? dataString(data, "kind");
  if (category === "digest" || category === "pomodoro") return "/(app)/(tabs)/dashboard";
  return "/(app)/today";
}
