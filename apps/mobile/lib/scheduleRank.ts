import type { Task } from "./types";
import { taskDeadlineDate } from "./taskDates";

export function isUnscheduled(task: Task) {
  return !task.completedAt && !task.recurrence && (task.blocks?.length ?? 0) === 0 && !task.scheduledOn;
}

export function scoreUnscheduledTask(task: Task, now = new Date()): number {
  let score = 0;
  if (task.blockedById) score -= 80;

  const deadline = taskDeadlineDate(task);
  if (deadline) {
    const day = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const slack = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (slack < 0) score += 100;
    else if (slack === 0) score += 50;
    else score += Math.max(0, 40 - slack * 4);
  }

  switch ((task.priorityLevel ?? "").trim().toLowerCase()) {
    case "urgent":
    case "critical":
      score += 40;
      break;
    case "high":
      score += 25;
      break;
    case "medium":
      score += 10;
      break;
  }

  if (task.todayFocusOn) score += 35;
  if (isUnscheduled(task)) score += 5;
  if ((task.actualMinutes ?? 0) > 0 && (task.duration ?? 0) > 0) score += 8;
  return score;
}

export function needsCalendarSlot(task: Task): boolean {
  if (!isUnscheduled(task)) return false;
  if (task.kind === "inbox" || task.kind === "reminder") return false;
  if ((task.duration ?? 0) <= 0) return false;
  return true;
}

export function rankUnscheduled(tasks: Task[], now = new Date()): Task[] {
  return [...tasks]
    .filter(needsCalendarSlot)
    .sort((a, b) => scoreUnscheduledTask(b, now) - scoreUnscheduledTask(a, now));
}
