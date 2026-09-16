"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarOff,
  CalendarPlus,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Pin,
  PinOff,
  RotateCcw,
  SkipForward,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import { formatTime, type CalendarEvent } from "@/app/utils/calendar";
import { isTaskKind, isOccurrenceKind } from "@/app/utils/calendar";
import {
  useApplySchedule,
  useClearTaskBlocks,
  useDeleteBlock,
  useDeleteEvent,
  useEditEventOccurrence,
  useMoveBlock,
  usePinBlock,
  usePinTask,
} from "@/app/utils/hooks/calendar";
import { useEditTaskOccurrence, useUpdateTask } from "@/app/utils/hooks/tasks";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

export type CalendarMenuHandlers = {
  /** Opens the event dialog for this block. */
  onOpenEvent: (event: CalendarEvent) => void;
  /** Opens the schedule dialog on an empty slot. */
  onSelectSlot?: (day: Date, hour: number) => void;
  /** Opens the auto-schedule dialog, optionally scoped to one task. */
  onAutoSchedule?: (taskIds?: string[]) => void;
  /** Jumps the calendar to a day. */
  onOpenDay?: (day: Date) => void;
};

const NUDGES = [
  { label: "15 minutes later", minutes: 15 },
  { label: "30 minutes later", minutes: 30 },
  { label: "1 hour later", minutes: 60 },
  { label: "15 minutes earlier", minutes: -15 },
  { label: "1 hour earlier", minutes: -60 },
];

function shiftBy(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Menus for the calendar: one for a block already on the grid, one for an
 * empty slot. */
export function useCalendarContextMenu(handlers: CalendarMenuHandlers) {
  const router = useRouter();
  const openTask = useEntityDetailStore((state) => state.openTask);
  const updateTask = useUpdateTask();
  const editTaskOccurrence = useEditTaskOccurrence();
  const editEventOccurrence = useEditEventOccurrence();
  const deleteEvent = useDeleteEvent();
  const deleteBlock = useDeleteBlock();
  const clearBlocks = useClearTaskBlocks();
  const moveBlock = useMoveBlock();
  const pinBlock = usePinBlock();
  const pinTask = usePinTask();
  const applySchedule = useApplySchedule();

  const rerun = useCallback(async () => {
    const activity = useScheduleActivityStore.getState();
    activity.start();
    try {
      activity.finish(await applySchedule.mutateAsync({ includeManual: false }));
    } catch (error) {
      activity.fail(error instanceof Error ? error.message : "Could not update schedule.");
    }
  }, [applySchedule]);

  const eventMenu = useCallback(
    (entry: CalendarEvent): ContextMenuEntry[] => {
      const task = entry.task;
      const isTask = isTaskKind(entry.kind);
      const pinnedBlock = entry.source === "manual";
      const completed = Boolean(entry.completedAt);
      const timeLabel = entry.allDay
        ? "All day"
        : `${formatTime(entry.start)} – ${formatTime(entry.end)}`;

      const nudgeSubmenu: ContextMenuEntry[] = NUDGES.map((nudge) => ({
        kind: "action",
        label: nudge.label,
        onSelect: () => {
          if (!entry.blockId) return;
          const start = shiftBy(entry.start, nudge.minutes);
          const end = shiftBy(entry.end, nudge.minutes);
          void moveBlock
            .mutateAsync({
              blockId: entry.blockId,
              start: start.toISOString(),
              end: end.toISOString(),
            })
            .then(() =>
              showUndoToast(`Moved to ${formatTime(start)}`, () => {
                void moveBlock.mutateAsync({
                  blockId: entry.blockId!,
                  start: entry.start.toISOString(),
                  end: entry.end.toISOString(),
                });
              }),
            )
            .catch(() => useToastStore.getState().show("Could not move block"));
        },
      }));

      return tidyEntries([
        { kind: "heading", label: timeLabel },
        {
          kind: "action",
          label: isTask ? "Open task details" : "Open event",
          icon: SquarePen,
          shortcut: "Enter",
          onSelect: () => {
            if (isTask && task) openTask(task.id);
            else handlers.onOpenEvent(entry);
          },
        },
        isTask && task && {
          kind: "action",
          label: "Open in task list",
          icon: ExternalLink,
          onSelect: () => router.push(`/tasks?taskId=${encodeURIComponent(task.id)}`),
        },
        { kind: "separator" },

        /* Completion — occurrences complete just their instance. */
        isTask && task && entry.kind === "taskOccurrence" && {
          kind: "action",
          label: completed ? "Reopen this occurrence" : "Complete this occurrence",
          icon: completed ? RotateCcw : Check,
          onSelect: () => {
            const originalStart = (entry.originalStart ?? entry.start).toISOString();
            void editTaskOccurrence
              .mutateAsync({
                id: task.id,
                originalStart,
                action: completed ? "uncomplete" : "complete",
              })
              .then(() =>
                useToastStore
                  .getState()
                  .show(completed ? "Occurrence reopened" : "Occurrence completed"),
              );
          },
        },
        isTask && task && entry.kind === "taskOccurrence" && {
          kind: "action",
          label: "Skip this occurrence",
          icon: SkipForward,
          onSelect: () => {
            const originalStart = (entry.originalStart ?? entry.start).toISOString();
            void editTaskOccurrence
              .mutateAsync({ id: task.id, originalStart, action: "skip" })
              .then(() => useToastStore.getState().show("Occurrence skipped"));
          },
        },
        isTask && task && entry.kind === "task" && {
          kind: "action",
          label: completed ? "Reopen task" : "Mark complete",
          icon: completed ? RotateCcw : Check,
          shortcut: "X",
          onSelect: () => {
            const previous = task.completedAt ?? "";
            void updateTask
              .mutateAsync({
                id: task.id,
                completedAt: completed ? "" : new Date().toISOString(),
              })
              .then(() =>
                showUndoToast(completed ? "Task reopened" : "Task completed", () => {
                  void updateTask.mutateAsync({ id: task.id, completedAt: previous });
                }),
              );
          },
        },
        !isTask && entry.event && isOccurrenceKind(entry.kind) && {
          kind: "action",
          label: "Skip this occurrence",
          icon: SkipForward,
          onSelect: () => {
            const originalStart = (entry.originalStart ?? entry.start).toISOString();
            void editEventOccurrence
              .mutateAsync({ id: entry.event!.id, originalStart, action: "skip" })
              .then(() => useToastStore.getState().show("Occurrence skipped"));
          },
        },
        { kind: "separator" },

        /* Placement — only blocks on the grid can be nudged or pinned. */
        entry.blockId && !entry.allDay && {
          kind: "submenu",
          label: "Move",
          icon: Clock,
          items: nudgeSubmenu,
        },
        entry.blockId && {
          kind: "action",
          label: pinnedBlock ? "Unpin from this time" : "Pin to this time",
          icon: pinnedBlock ? PinOff : Pin,
          onSelect: () => {
            void pinBlock
              .mutateAsync({ blockId: entry.blockId!, locked: !pinnedBlock })
              .then(() =>
                useToastStore
                  .getState()
                  .show(pinnedBlock ? "Block unpinned" : "Block pinned"),
              )
              .catch(() => useToastStore.getState().show("Could not update pin"));
          },
        },
        isTask && task && {
          kind: "action",
          label: task.scheduleLocked ? "Let auto-schedule move this" : "Lock task schedule",
          icon: task.scheduleLocked ? PinOff : Pin,
          onSelect: () => {
            void pinTask
              .mutateAsync({ taskId: task.id, locked: !task.scheduleLocked })
              .then(() =>
                useToastStore
                  .getState()
                  .show(task.scheduleLocked ? "Schedule unlocked" : "Schedule locked"),
              );
          },
        },
        isTask && task && handlers.onAutoSchedule && {
          kind: "action",
          label: "Re-schedule this task…",
          icon: Sparkles,
          onSelect: () => handlers.onAutoSchedule?.([task.id]),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Copy title",
          icon: Copy,
          onSelect: () => {
            void navigator.clipboard
              .writeText(entry.title)
              .then(() => useToastStore.getState().show("Title copied"))
              .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
          },
        },
        { kind: "separator" },

        /* Removal — a block leaves the calendar, an event is deleted. */
        entry.blockId && {
          kind: "action",
          label: "Remove this block",
          icon: CalendarOff,
          danger: true,
          onSelect: () => {
            void deleteBlock
              .mutateAsync(entry.blockId!)
              .then(() => useToastStore.getState().show("Block removed"))
              .catch(() => useToastStore.getState().show("Could not remove block"));
          },
        },
        isTask && task && (task.blocks?.length ?? 0) > 1 && {
          kind: "action",
          label: "Clear all time for this task",
          icon: CalendarOff,
          danger: true,
          onSelect: () => {
            void clearBlocks
              .mutateAsync(task.id)
              .then(() => {
                useToastStore.getState().show("Task unscheduled");
                void rerun();
              })
              .catch(() => useToastStore.getState().show("Could not unschedule task"));
          },
        },
        !isTask && entry.event && {
          kind: "action",
          label: entry.event.recurrence ? "Delete whole series" : "Delete event",
          icon: Trash2,
          danger: true,
          shortcut: "mod+Backspace",
          onSelect: () =>
            requestConfirm({
              title: `Delete “${entry.title}”?`,
              description: entry.event?.recurrence
                ? "Every occurrence of this series is removed. This cannot be undone."
                : "This cannot be undone.",
              onConfirm: async () => {
                await deleteEvent.mutateAsync(entry.event!.id);
                useToastStore.getState().show("Event deleted");
              },
            }),
        },
      ]);
    },
    [
      clearBlocks,
      deleteBlock,
      deleteEvent,
      editEventOccurrence,
      editTaskOccurrence,
      handlers,
      moveBlock,
      openTask,
      pinBlock,
      pinTask,
      rerun,
      router,
      updateTask,
    ],
  );

  const slotMenu = useCallback(
    (day: Date, hour: number): ContextMenuEntry[] => {
      const stamp = new Date(day);
      stamp.setHours(hour, 0, 0, 0);

      return tidyEntries([
        {
          kind: "heading",
          label: stamp.toLocaleString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
          }),
        },
        handlers.onSelectSlot && {
          kind: "action",
          label: "Schedule something here…",
          icon: CalendarPlus,
          onSelect: () => handlers.onSelectSlot?.(day, hour),
        },
        handlers.onAutoSchedule && {
          kind: "action",
          label: "Auto-schedule…",
          icon: Sparkles,
          onSelect: () => handlers.onAutoSchedule?.(),
        },
        handlers.onOpenDay && {
          kind: "separator",
        },
        handlers.onOpenDay && {
          kind: "action",
          label: "Open this day",
          icon: ExternalLink,
          onSelect: () => handlers.onOpenDay?.(day),
        },
      ]);
    },
    [handlers],
  );

  return { eventMenu, slotMenu };
}
