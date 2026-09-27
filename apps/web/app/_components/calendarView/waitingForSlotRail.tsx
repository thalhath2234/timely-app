"use client";

import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Task } from "@/app/_types/types";
import { formatDuration } from "@/app/utils/calendar";
import { taskEntityColor } from "@/app/utils/entityColor";
import { useRank } from "@/app/utils/hooks/calendar";
import { setTaskDragData } from "@/app/utils/taskDrag";
import { taskDeadlineDate } from "@/app/utils/taskDates";
import { cn } from "@/app/utils/cn";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { AnimatePresence, motion } from "motion/react";
import { hoverLift, springSoft } from "@/app/_components/_ui/motion";

export default function WaitingForSlotRail({
  onSchedule,
  onOpen,
}: {
  onSchedule: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const rank = useRank();
  const waiting = useMemo(() => (rank.data ?? []).map((row) => row.task), [rank.data]);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const dragged = useRef(false);

  if (waiting.length === 0) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-muted">
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
      <AnimatePresence initial={false}>
      {open ? (
        <motion.ul
          key="waiting-list"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={springSoft}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {waiting.map((task) => {
            const deadline = taskDeadlineDate(task);
            return (
              <motion.li key={task.id} layout whileHover={hoverLift}>
                <div
                  draggable
                  onDragStart={(event) => {
                    dragged.current = true;
                    setTaskDragData(event, task.id);
                  }}
                  onDragEnd={() => {
                    dragged.current = false;
                  }}
                  onClick={() => {
                    if (dragged.current) {
                      dragged.current = false;
                      return;
                    }
                    onOpen(task.id);
                  }}
                  onContextMenu={(event) =>
                    openMenu(
                      event,
                      taskMenu(task, {
                        extra: tidyEntries([
                          {
                            kind: "action",
                            label: "Schedule this…",
                            icon: Sparkles,
                            onSelect: () => onSchedule(task.id),
                          },
                        ]),
                      }),
                      { title: task.name },
                    )
                  }
                  className={cn(
                    "mb-1.5 flex cursor-pointer overflow-hidden rounded-lg border border-border bg-background active:cursor-grabbing",
                    task.blockedById && "opacity-70",
                  )}
                >
                  <span
                    className="w-1 shrink-0"
                    style={{ backgroundColor: taskEntityColor(task) }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(task.id);
                    }}
                    className={cn("block w-full truncate text-left text-sm font-medium text-foreground hover:underline", task.completedAt && "text-muted-foreground line-through")}
                  >
                    {task.name}
                  </button>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {task.duration > 0 ? formatDuration(task.duration) : "No estimate"}
                    {deadline
                      ? ` · due ${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : ""}
                    {task.blockedById ? " · waiting on another task" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSchedule(task.id);
                    }}
                    className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    Schedule this
                  </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      ) : null}
      </AnimatePresence>
    </aside>
  );
}
