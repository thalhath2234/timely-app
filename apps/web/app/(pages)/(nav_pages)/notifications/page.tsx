"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/_components/_ui/emptyState";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import {
  useClearNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useSnoozeNotification,
} from "@/app/utils/hooks/notifications";
import type { AppNotification } from "@/app/_types/types";
import { motion } from "motion/react";
import { hoverLift, listContainerVariants, listItemVariants } from "@/app/_components/_ui/motion";

type NotificationTarget =
  | { kind: "task"; id: string }
  | { kind: "route"; href: string };

function dataString(item: AppNotification, key: string) {
  const value = item.data?.[key];
  return typeof value === "string" && value ? value : null;
}

function targetFor(item: AppNotification): NotificationTarget {
  const fromData = item.data?.taskId;
  if (typeof fromData === "string" && fromData) return { kind: "task", id: fromData };
  if (item.entityType === "task" && item.entityId) return { kind: "task", id: item.entityId };

  const entityId = item.entityId;
  if (entityId) {
    if (item.entityType === "chat") return { kind: "route", href: `/chat?id=${encodeURIComponent(entityId)}` };
    if (item.entityType === "project") return { kind: "route", href: `/projects/${entityId}` };
    if (item.entityType === "doc") return { kind: "route", href: `/docs/${entityId}` };
    if (item.entityType === "sheet") return { kind: "route", href: `/sheets/${entityId}` };
    if (item.entityType === "event") return { kind: "route", href: "/calendar" };
  }

  const dataRoutes = [
    ["projectId", "projects"],
    ["docId", "docs"],
    ["sheetId", "sheets"],
  ] as const;
  for (const [key, segment] of dataRoutes) {
    const id = dataString(item, key);
    if (id) return { kind: "route", href: `/${segment}/${id}` };
  }
  if (dataString(item, "eventId")) return { kind: "route", href: "/calendar" };
  if (item.category === "digest") return { kind: "route", href: "/report" };
  return { kind: "route", href: "/today" };
}

function tomorrowNine() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

export default function NotificationsPage() {
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const clearAll = useClearNotifications();
  const snooze = useSnoozeNotification();
  const openTask = useEntityDetailStore((state) => state.openTask);
  const items = list.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Reminders, morning planning, and evening recap. Snooze updates the reminder itself.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={markAll.isPending || items.length === 0 || items.every((item) => item.readAt)}
            onClick={() => void markAll.mutateAsync()}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:border-primary/30 disabled:opacity-50"
          >
            Mark all read
          </button>
          <button
            type="button"
            disabled={clearAll.isPending || items.length === 0}
            onClick={() =>
              requestConfirm({
                title: "Clear all notifications?",
                description: "This removes them from the list. It cannot be undone.",
                confirmLabel: "Clear all",
                pendingLabel: "Clearing…",
                onConfirm: () => clearAll.mutateAsync(),
              })
            }
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-destructive hover:border-destructive/40 disabled:opacity-50"
          >
            Clear all
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading notifications…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Due reminders and daily digests will show up here, including when the app is closed."
          />
        ) : (
          <motion.ul
            className="space-y-2"
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
          >
            {items.map((item) => {
              const target = targetFor(item);
              const unread = !item.readAt;
              return (
                <motion.li
                  key={item.id}
                  variants={listItemVariants}
                  whileHover={hoverLift}
                  className={`rounded-xl border border-border bg-card px-3 py-3 ${unread ? "border-l-2 border-l-primary bg-primary/10" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (unread) void markRead.mutateAsync(item.id);
                        if (target.kind === "task") openTask(target.id);
                        else router.push(target.href);
                      }}
                    >
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.body ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {item.category} · {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </button>
                    {unread ? (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void markRead.mutateAsync(item.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                  {item.category === "reminder" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-border bg-muted px-2 py-1 text-xs hover:border-primary/30"
                        onClick={() => void snooze.mutateAsync({ id: item.id, minutes: 15 })}
                      >
                        Snooze 15m
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border bg-muted px-2 py-1 text-xs hover:border-primary/30"
                        onClick={() => void snooze.mutateAsync({ id: item.id, minutes: 60 })}
                      >
                        Snooze 1h
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border bg-muted px-2 py-1 text-xs hover:border-primary/30"
                        onClick={() => void snooze.mutateAsync({ id: item.id, until: tomorrowNine() })}
                      >
                        Tomorrow 9:00
                      </button>
                    </div>
                  ) : null}
                  {snooze.isError ? (
                    <p className="mt-2 text-xs text-destructive">
                      {snooze.error instanceof Error ? snooze.error.message : "Could not snooze."}
                    </p>
                  ) : null}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
