"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Clock,
  FolderKanban,
  ListTodo,
  MoveRight,
} from "lucide-react";
import type { CalendarItem } from "@/app/_types/types";
import BottomSheet from "../BottomSheet";
import DateTimeSheet from "../DateTimeSheet";
import { formatDuration, formatRelativeDay, formatTimeRange } from "@/app/_lib/mobile/format";
import { isTaskItem, itemColor } from "./CalendarItemRow";

interface CalendarItemSheetProps {
  item: CalendarItem | null;
  onClose: () => void;
  onToggleComplete?: (item: CalendarItem) => void;
  /** Move the block or event so it starts at `start`, keeping its duration. */
  onReschedule?: (item: CalendarItem, start: Date) => void;
}

export default function CalendarItemSheet({
  item,
  onClose,
  onToggleComplete,
  onReschedule,
}: CalendarItemSheetProps) {
  const [moving, setMoving] = useState(false);
  const task = item?.task;
  const isTask = item ? isTaskItem(item) : false;
  const done = Boolean(item?.completedAt);
  const description = task?.description || item?.event?.description || "";
  const minutes = item
    ? Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000)
    : 0;
  // Recurring occurrences are edited through their series on desktop; keep the
  // mobile move action to concrete blocks and one-off events.
  const canMove =
    Boolean(onReschedule) &&
    Boolean(item) &&
    (item!.kind === "task" ? Boolean(item!.blockId) : item!.kind === "event");

  return (
    <>
      <BottomSheet open={Boolean(item)} onClose={onClose}>
        {item ? (
          <div className="flex flex-col gap-4 pt-1">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: itemColor(item) }}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isTask ? <ListTodo size={12} /> : <CalendarClock size={12} />}
                  {isTask ? "Task block" : "Event"}
                </p>
                <h2
                  className={`text-[20px] font-semibold leading-tight text-foreground ${
                    done ? "line-through opacity-60" : ""
                  }`}
                >
                  {item.title}
                </h2>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <button
                type="button"
                disabled={!canMove}
                onClick={() => setMoving(true)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted disabled:active:bg-transparent"
              >
                <Clock size={18} className="text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-[15px] text-card-foreground">
                    {formatRelativeDay(new Date(item.start))}
                    {" · "}
                    {new Date(item.start).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.allDay ? "All day" : formatTimeRange(item.start, item.end)}
                    {!item.allDay && minutes ? ` · ${formatDuration(minutes)}` : ""}
                  </p>
                </div>
                {canMove ? <MoveRight size={16} className="text-muted-foreground/60" /> : null}
              </button>
              {task?.project ? (
                <>
                  <div className="mx-4 h-px bg-border" />
                  <div className="flex items-center gap-3 px-4 py-3">
                    <FolderKanban size={18} className="text-muted-foreground" />
                    <p className="flex items-center gap-2 text-[15px] text-card-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: task.project.color ?? "var(--muted-foreground)" }}
                      />
                      {task.project.title}
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            {description ? (
              <p className="px-1 text-[15px] leading-relaxed text-muted-foreground text-pretty">
                {description}
              </p>
            ) : null}

            <div className="flex gap-2">
              {isTask && onToggleComplete ? (
                <button
                  type="button"
                  onClick={() => onToggleComplete(item)}
                  className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold ${
                    done ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                  }`}
                >
                  <Check size={18} strokeWidth={3} />
                  {done ? "Mark incomplete" : "Complete"}
                </button>
              ) : null}
              {canMove ? (
                <button
                  type="button"
                  onClick={() => setMoving(true)}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-medium text-foreground active:bg-muted"
                >
                  <Clock size={16} />
                  Reschedule
                </button>
              ) : null}
              {item.taskId ? (
                <Link
                  href={`/m/tasks/${item.taskId}`}
                  onClick={onClose}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-medium text-foreground active:bg-muted"
                >
                  Open task
                  <ArrowUpRight size={16} />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <DateTimeSheet
        open={moving && Boolean(item)}
        onClose={() => setMoving(false)}
        title="Reschedule"
        value={item ? new Date(item.start) : null}
        onChange={(start) => {
          if (start && item) onReschedule?.(item, start);
          setMoving(false);
          onClose();
        }}
        mode={item?.allDay ? "date" : "datetime"}
      />
    </>
  );
}
