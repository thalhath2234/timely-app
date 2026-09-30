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
  const taskId = dataString(data, "taskId");
  if (taskId) return `/(app)/tasks/${taskId}`;

  const entityType = dataString(data, "entityType");
  const entityId = dataString(data, "entityId");
  if (entityType && entityId) {
    if (entityType === "task") return `/(app)/tasks/${entityId}`;
    if (entityType === "project") return `/(app)/projects/${entityId}`;
    if (entityType === "doc") return `/(app)/docs/${entityId}`;
    if (entityType === "sheet") return `/(app)/sheets/${entityId}`;
    if (entityType === "event") return `/(app)/events/${entityId}`;
  }

  const entityRoutes = [
    ["projectId", "projects"],
    ["docId", "docs"],
    ["sheetId", "sheets"],
    ["eventId", "events"],
  ] as const;
  for (const [key, segment] of entityRoutes) {
    const id = dataString(data, key);
    if (id) return `/(app)/${segment}/${id}`;
  }

  const category = dataString(data, "category") ?? dataString(data, "kind");
  if (category === "digest") return "/(app)/report";
  return "/(app)/today";
}
