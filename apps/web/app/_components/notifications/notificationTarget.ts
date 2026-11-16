// Where a notification opens. Pure, so scripts/notification-target.test.mjs
// runs it under Node; keep imports relative, type-only or from the contract.
import {
  ASSISTANT_PATH,
  assistantHref,
  notificationToAssistant,
} from "@timely/contract/assistant";
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

/**
 * A Bot alert opens its Bot thread in the Assistant (the alert is posted
 * there too): `thread` is the thread's conversation id when the alert names
 * it, else 1 for "this Bot's thread". One without a bot id opens the Assistant.
 */
export function botHref(item: Pick<AppNotification, "data">): string {
  const bot = dataString(item, "botId");
  if (!bot) return ASSISTANT_PATH;
  return assistantHref({ bot, thread: dataString(item, "threadId") ?? "1" });
}

export function targetFor(item: AppNotification): NotificationTarget {
  if (item.category === "bot") return { kind: "route", href: botHref(item) };
  const fromData = item.data?.taskId;
  if (typeof fromData === "string" && fromData)
    return { kind: "task", id: fromData };
  if (item.entityType === "task" && item.entityId)
    return { kind: "task", id: item.entityId };

  // A chat notification opens its chat in the Assistant.
  const assistant = notificationToAssistant(item);
  if (assistant) return { kind: "route", href: assistant };

  const entityId = item.entityId;
  if (entityId) {
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
 * Where a desktop alert opens when clicked: its Bot thread (or its chat),
 * found among the notification lists already in the query cache (`cached` is
 * every ["notifications", …] entry, which also holds counts and settings),
 * else the Assistant.
 */
export function openedAlertHref(
  id: string,
  cached: readonly unknown[],
): string {
  for (const list of cached) {
    if (!Array.isArray(list)) continue;
    const item = (list as AppNotification[]).find((entry) => entry?.id === id);
    if (!item) continue;
    const target = targetFor(item);
    return target.kind === "route"
      ? target.href
      : `/tasks?taskId=${encodeURIComponent(target.id)}`;
  }
  return ASSISTANT_PATH;
}
