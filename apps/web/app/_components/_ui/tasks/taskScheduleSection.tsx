"use client";

import { useState } from "react";
import { CalendarDays, Pin, Plus, Repeat, Sparkles, X } from "lucide-react";
import { DateTimeField } from "@/app/_components/_ui/datePicker";
import { SidebarSectionTitle } from "@/app/_components/_ui/modal/entityModal";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import type {
  RecurrenceInput,
  RecurrenceRule,
  ScheduledBlock,
} from "@/app/_types/types";
import { formatDateTime, formatDuration, formatTime, isSameDay } from "@/app/utils/calendar";
import {
  buildRecurrenceInput,
  describeRRule,
  rruleToDraft,
  type RecurrenceDraft,
} from "@/app/utils/recurrence";
import {
  useAddTaskBlock,
  useApplySchedule,
  useClearTaskBlocks,
  useDeleteBlock,
} from "@/app/utils/hooks/calendar";
import { cn } from "@/app/utils/cn";

type TaskScheduleSectionProps = {
  taskId: string;
  duration: number;
  deadline: string | null;
  completed: boolean;
  recurrence: RecurrenceRule | null | undefined;
  blocks: ScheduledBlock[] | undefined;
  /** Persists the rule (or `null` to make the task one-off). */
  onRecurrenceChange: (recurrence: RecurrenceInput | null) => void;
};

const smallButton =
  "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60";

/**
 * Sidebar block for a task's time on the calendar: its repeat rule, the blocks
 * it occupies, an ETA against the deadline, and a one-click auto-schedule.
 */
export default function TaskScheduleSection({
  taskId,
  duration,
  deadline,
  completed,
  recurrence,
  blocks,
  onRecurrenceChange,
}: TaskScheduleSectionProps) {
  const addBlock = useAddTaskBlock();
  const deleteBlock = useDeleteBlock();
  const clearBlocks = useClearTaskBlocks();
  const applySchedule = useApplySchedule();

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anchor = recurrence ? new Date(recurrence.dtstart) : nextRoundHour();
  const draft: RecurrenceDraft | null = recurrence
    ? rruleToDraft(recurrence.rrule, anchor)
    : null;

  const sorted = [...(blocks ?? [])].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const plannedMinutes = sorted.reduce(
    (sum, block) =>
      sum + Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000),
    0,
  );
  const eta = sorted.length ? new Date(sorted[sorted.length - 1].end) : null;
  const deadlineDate = deadline ? new Date(deadline) : null;
  const lateEta = Boolean(eta && deadlineDate && eta > endOfDay(deadlineDate));

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  const pending =
    addBlock.isPending || deleteBlock.isPending || clearBlocks.isPending || applySchedule.isPending;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <SidebarSectionTitle>Schedule</SidebarSectionTitle>

      <RecurrenceEditor
        label="Repeat"
        icon={Repeat}
        value={draft}
        anchor={anchor}
        onChange={(next) => {
          // A rule only carries an anchor when it already exists; a new one
          // starts from the next round hour so the first occurrence is soon.
          onRecurrenceChange(buildRecurrenceInput(next, anchor));
        }}
      />

      {recurrence ? (
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {describeRRule(recurrence.rrule, anchor)} from {formatDateTime(anchor)}.
          Each occurrence is completed on its own from the calendar.
        </p>
      ) : (
        <>
          {!completed && (
            <p
              className={cn(
                "mx-1 mt-2 rounded-lg px-3 py-2 text-xs",
                eta
                  ? lateEta
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {eta
                ? `ETA ${formatDateTime(eta)}${lateEta ? " · after deadline" : ""}`
                : duration > 0
                  ? "No ETA yet: this task is not on the calendar."
                  : "Add a duration to schedule this task."}
              {eta && duration > plannedMinutes
                ? ` · ${formatDuration(duration - plannedMinutes)} still unplanned`
                : ""}
            </p>
          )}

          {sorted.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 px-1">
              {sorted.map((block) => {
                const start = new Date(block.start);
                const end = new Date(block.end);
                return (
                  <li
                    key={block.id}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    {block.source === "engine" ? (
                      <Sparkles className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <Pin className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate tabular-nums text-foreground">
                      {formatDateTime(start)} – {formatTime(end)}
                      {!isSameDay(start, end) ? ` (${formatDateTime(end)})` : ""}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove block"
                      disabled={pending}
                      onClick={() =>
                        run(() => deleteBlock.mutateAsync(block.id), "Could not remove block.")
                      }
                      className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {adding && (
            <div className="mt-2 px-1">
              <DateTimeField
                value={null}
                clearable={false}
                onChange={(iso) => {
                  if (!iso) return;
                  setAdding(false);
                  run(
                    () =>
                      addBlock.mutateAsync({
                        taskId,
                        start: iso,
                        durationMinutes: Math.max(15, duration || 30),
                      }),
                    "Could not add block.",
                  );
                }}
              />
            </div>
          )}

          {!completed && (
            <div className="mt-2 flex flex-wrap gap-1 px-1">
              <button
                type="button"
                disabled={pending || duration <= 0}
                onClick={() =>
                  run(
                    () => applySchedule.mutateAsync({ taskIds: [taskId] }),
                    "Could not auto-schedule.",
                  )
                }
                className={cn(smallButton, "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <Sparkles className="size-3" />
                {applySchedule.isPending ? "Scheduling..." : "Auto-schedule"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAdding((open) => !open)}
                className={cn(smallButton, "bg-secondary text-secondary-foreground hover:bg-accent")}
              >
                {adding ? <X className="size-3" /> : <Plus className="size-3" />}
                {adding ? "Cancel" : "Pick a time"}
              </button>
              {sorted.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => clearBlocks.mutateAsync(taskId), "Could not unschedule.")
                  }
                  className={cn(smallButton, "text-destructive hover:bg-destructive/10")}
                >
                  <CalendarDays className="size-3" />
                  Unschedule
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-1 px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function nextRoundHour(): Date {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}
