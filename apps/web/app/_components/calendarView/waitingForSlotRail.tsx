"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Task } from "@/app/_types/types";
import { formatDuration } from "@/app/utils/calendar";
import { taskEntityColor } from "@/app/utils/entityColor";
import { rankUnscheduled } from "@/app/utils/scheduleRank";
import { setTaskDragData } from "@/app/utils/taskDrag";
import { taskDeadlineDate } from "@/app/utils/taskDates";
import { cn } from "@/app/utils/cn";

export default function WaitingForSlotRail({
  tasks,
  onSchedule,
}: {
  tasks: Task[];
  onSchedule: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const waiting = useMemo(() => rankUnscheduled(tasks), [tasks]);

  if (waiting.length === 0) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0c0e14]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 border-b border-border px-3 py-2 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">Waiting for a slot</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {waiting.length}
        </span>
      </button>
      {open ? (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {waiting.map((task) => {
            const deadline = taskDeadlineDate(task);
            return (
              <li key={task.id}>
                <div
                  draggable
                  onDragStart={(event) => setTaskDragData(event, task.id)}
                  className={cn(
                    "mb-1.5 flex cursor-grab overflow-hidden rounded-lg border border-border bg-background active:cursor-grabbing",
                    task.blockedById && "opacity-70",
                  )}
                >
                  <span
                    className="w-1 shrink-0"
                    style={{ backgroundColor: taskEntityColor(task) }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 px-2.5 py-2">
                  <p className="truncate text-sm font-medium text-foreground">{task.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {task.duration > 0 ? formatDuration(task.duration) : "No estimate"}
                    {deadline
                      ? ` · due ${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : ""}
                    {task.blockedById ? " · waiting on another task" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSchedule(task.id)}
                    className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    Schedule this
                  </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </aside>
  );
}
