import type { DragEvent } from "react";

/** Custom MIME so calendar / Gantt drops can ignore unrelated drags. */
export const TASK_DRAG_MIME = "application/x-timely-task";

export function setTaskDragData(event: DragEvent, taskId: string) {
  event.dataTransfer.setData(TASK_DRAG_MIME, taskId);
  event.dataTransfer.setData("text/plain", taskId);
  event.dataTransfer.effectAllowed = "copyMove";
}

export function readTaskDragId(event: DragEvent): string {
  return event.dataTransfer.getData(TASK_DRAG_MIME) || event.dataTransfer.getData("text/plain") || "";
}

export function dragHasTask(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).some(
    (type) => type === TASK_DRAG_MIME || type === "text/plain",
  );
}
