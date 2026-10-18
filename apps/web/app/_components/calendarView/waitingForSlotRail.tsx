"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RailSection } from "@/app/_components/_ui/pageWithRail";
import { formatDuration } from "@/app/utils/calendar";
import { taskEntityColor } from "@/app/utils/entityColor";
import { useWaitingForSlot } from "@/app/utils/hooks/calendar";
import { setTaskDragData } from "@/app/utils/taskDrag";
import { taskDeadlineDate } from "@/app/utils/taskDates";
import { cn } from "@/app/utils/cn";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import { AnimatePresence, motion } from "motion/react";
import { springSoft } from "@/app/_components/_ui/motion";
import { useCanReplay } from "./scheduleReplay";

/**
 * Tasks with no block yet, as a rail card: a state line says what the
 * scheduler is doing, then one compact row per task with a Schedule link.
 * Rows drag onto the grid.
 */
export default function WaitingForSlotRail({
  onSchedule,
  onOpen,
}: {
  onSchedule: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const rank = useWaitingForSlot();
  const waiting = useMemo(() => (rank.data ?? []).map((row) => row.task), [rank.data]);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const dragged = useRef(false);
  const activityStatus = useScheduleActivityStore((state) => state.status);
  const activityMessage = useScheduleActivityStore((state) => state.message);
  const showReplay = useScheduleActivityStore((state) => state.showReplay);
  const canReplay = useCanReplay();

  if (waiting.length === 0) return null;

  const stateLine =
    activityStatus === "running"
      ? activityMessage || "Placing tasks in your working hours…"
      : activityStatus === "error"
        ? activityMessage || "The last run could not place everything."
        : "Drag a task onto the grid, or let Auto-schedule place it.";

  return (
    <RailSection
      title="Waiting for a slot"
      meta={<span className="tabular-nums">{waiting.length}</span>}
      action={
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        </button>
      }
      className="flex min-h-0 flex-col"
      data-testid="waiting-rail"
    >
      <p className={cn("text-xs", activityStatus === "error" ? "text-destructive" : "text-muted-foreground")}>
        {stateLine}
        {activityStatus === "done" && canReplay ? (
          <>
            {" "}
            <button type="button" onClick={showReplay} className="font-medium text-primary hover:underline">
              Show me
            </button>
          </>
        ) : null}
      </p>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            key="waiting-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSoft}
            className="mt-2 min-h-0 flex-1 overflow-y-auto"
          >
            {waiting.map((task) => {
              const deadline = taskDeadlineDate(task);
              return (
                <li
                  key={task.id}
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
                          { kind: "action", label: "Schedule this…", icon: Sparkles, onSelect: () => onSchedule(task.id) },
                        ]),
                      }),
                      { title: task.name },
                    )
                  }
                  className={cn(
                    "flex cursor-grab items-center gap-2.5 border-t border-border py-2 first:border-t-0 active:cursor-grabbing",
                    task.blockedById && "opacity-70",
                  )}
                >
                  <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: taskEntityColor(task) }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-[13px] font-medium text-foreground", task.completedAt && "text-muted-foreground line-through")}>{task.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {task.duration > 0 ? formatDuration(task.duration) : "No estimate"}
                      {deadline ? ` · due ${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                      {task.blockedById ? " · waiting on another task" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSchedule(task.id);
                    }}
                    className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-muted"
                  >
                    Schedule
                  </button>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </RailSection>
  );
}
