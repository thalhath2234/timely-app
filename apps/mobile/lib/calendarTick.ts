import { useCallback } from "react";
import { calendarItemDone } from "@timely/contract/calendar";
import { useEditTaskOccurrence, useSaveTask } from "./hooks";
import { showUndoToast, useToastStore } from "./toast";
import type { CalendarItem } from "./types";

/**
 * Ticks a calendar entry on or off, with Undo. A repeating task is ticked one
 * day at a time: ticking the task itself would end the whole series.
 */
export function useTickCalendarItem() {
  const { mutateAsync: saveTask } = useSaveTask();
  const { mutateAsync: editOccurrence } = useEditTaskOccurrence();
  return useCallback(
    (item: CalendarItem) => {
      const taskId = item.taskId;
      if (!taskId) return;
      const done = calendarItemDone(item);
      const message = done ? `Reopened “${item.title}”` : `Completed “${item.title}”`;
      const failed = () => useToastStore.getState().show(`Couldn’t update “${item.title}”. Try again.`);
      if (item.kind === "taskOccurrence" && item.originalStart) {
        const occurrence = { id: taskId, originalStart: item.originalStart };
        void editOccurrence({ ...occurrence, action: done ? "uncomplete" : "complete" }).then(
          () => showUndoToast(message, () => void editOccurrence({ ...occurrence, action: done ? "complete" : "uncomplete" }).catch(failed)),
          failed,
        );
        return;
      }
      const previous = item.task?.completedAt ?? "";
      void saveTask({ id: taskId, data: { completedAt: done ? "" : new Date().toISOString() } }).then(
        () => showUndoToast(message, () => void saveTask({ id: taskId, data: { completedAt: previous } }).catch(failed)),
        failed,
      );
    },
    [saveTask, editOccurrence],
  );
}
