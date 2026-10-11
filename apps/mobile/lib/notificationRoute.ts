// Same as fileHref in ./fileRoutes. Inlined because this module stays free of
// runtime imports so `make test-mobile-assistant` can load it with plain Node.
function filePath(id: string) {
  return `/(app)/files/${encodeURIComponent(id)}`;
}

function dataString(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value ? value : null;
}

export function routeForNotification(data: Record<string, unknown>): string {
  const chatId =
    dataString(data, "chatId") ??
    (dataString(data, "entityType") === "chat"
      ? dataString(data, "entityId")
      : null);
  if (chatId) return `/(app)/assistant?chatId=${encodeURIComponent(chatId)}`;
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
  if (category === "digest" || category === "pomodoro") return "/(app)/dashboard";
  return "/(app)/today";
}
