// Where a notification opens. Pure, so scripts/notification-target.test.mjs
// runs it under Node; keep imports relative (or type-only).
import type { AppNotification } from "@timely/contract/notifications";
import { fileHref } from "../../utils/fileRoutes";

export type NotificationTarget =
  | { kind: "task"; id: string }
  | { kind: "route"; href: string };

export function dataString(item: Pick<AppNotification, "data">, key: string) {
  const value = item.data?.[key];
  return typeof value === "string" && value ? value : null;
}

/** The tasks a smart alert lists, in its order. */
export function alertItems(
  item: Pick<AppNotification, "data">,
): { id: string; name: string }[] {
  const raw = item.data?.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is { id: string; name: string } =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as { id?: unknown }).id === "string" &&
      typeof (entry as { name?: unknown }).name === "string",
  );
}

/** A Bot alert opens its bot on the Bots page; one without a bot id opens the board. */
export function botHref(item: Pick<AppNotification, "data">): string {
  const botId = dataString(item, "botId");
  return botId ? `/bots?bot=${encodeURIComponent(botId)}` : "/bots";
}

export function targetFor(item: AppNotification): NotificationTarget {
  if (item.category === "bot") return { kind: "route", href: botHref(item) };
  const fromData = item.data?.taskId;
  if (typeof fromData === "string" && fromData)
    return { kind: "task", id: fromData };
  if (item.entityType === "task" && item.entityId)
    return { kind: "task", id: item.entityId };

  const entityId = item.entityId;
  if (entityId) {
    if (item.entityType === "chat")
      return {
        kind: "route",
        href: `/chat?id=${encodeURIComponent(entityId)}`,
      };
    if (item.entityType === "project")
      return { kind: "route", href: `/projects/${entityId}` };
    if (item.entityType === "doc" || item.entityType === "sheet")
      return { kind: "route", href: fileHref(entityId) };
    if (item.entityType === "event")
      return { kind: "route", href: "/calendar" };
  }

  const projectId = dataString(item, "projectId");
  if (projectId) return { kind: "route", href: `/projects/${projectId}` };
  const fileId = dataString(item, "docId") ?? dataString(item, "sheetId");
  if (fileId) return { kind: "route", href: fileHref(fileId) };
  if (dataString(item, "eventId")) return { kind: "route", href: "/calendar" };
  if (item.category === "digest") return { kind: "route", href: "/dashboard" };
  if (item.category === "suggestion" && dataString(item, "kind") === "inbox")
    return { kind: "route", href: "/inbox" };
  if (item.category === "suggestion") {
    const first = alertItems(item)[0];
    if (first) return { kind: "task", id: first.id };
  }
  return { kind: "route", href: "/today" };
}

/**
 * Where a desktop Bot alert opens when clicked: its bot, found among the
 * notification lists already in the query cache (`cached` is every
 * ["notifications", …] entry, which also holds counts and settings), else the
 * board.
 */
export function openedAlertHref(
  id: string,
  cached: readonly unknown[],
): string {
  for (const list of cached) {
    if (!Array.isArray(list)) continue;
    const item = (list as AppNotification[]).find((entry) => entry?.id === id);
    if (item) return botHref(item);
  }
  return "/bots";
}
