"use client";

import { useState } from "react";
import { CalendarDays, Clock, Pin, Plus, Repeat, Sparkles, X } from "lucide-react";
import { DateTimeField, TimeField } from "@/app/_components/_ui/datePicker";
import { SidebarSectionTitle } from "@/app/_components/_ui/modal/entityModal";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import type {
  PreferredWindow,
  RecurrenceInput,
  RecurrenceRule,
  ScheduledBlock,
} from "@/app/_types/types";
import {
  applyClockToDate,
  dateFromDateInput,
  formatDateTime,
  formatDuration,
  formatTime,
  isSameDay,
  toTimeInputValue,
} from "@/app/utils/calendar";
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
  usePinBlock,
  usePinTask,
} from "@/app/utils/hooks/calendar";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { cn } from "@/app/utils/cn";

type TaskScheduleSectionProps = {
  taskId: string;
  duration: number;
  deadline: string | null;
  startDate?: string | null;
  completed: boolean;
  scheduledOn?: string | null;
  recurrence: RecurrenceRule | null | undefined;
  blocks: ScheduledBlock[] | undefined;
  scheduleLocked?: boolean;
  contiguous?: boolean;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  earliestStartAt?: string | null;
  preferredWindows?: PreferredWindow[];
  /** Persists the rule (or `null` to make the task one-off). */
  onRecurrenceChange: (recurrence: RecurrenceInput | null) => void;
  /** One-off reminder time (no work block). */
  onScheduledOnChange?: (isoOrEmpty: string) => void;
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
  startDate,
  completed,
  scheduledOn,
  recurrence,
  blocks,
  scheduleLocked = false,
  contiguous = false,
  minChunkMinutes = 15,
  preferredChunkMinutes,
  earliestStartAt,
  preferredWindows,
  onRecurrenceChange,
  onScheduledOnChange,
}: TaskScheduleSectionProps) {
  const addBlock = useAddTaskBlock();
  const deleteBlock = useDeleteBlock();
  const clearBlocks = useClearTaskBlocks();
  const applySchedule = useApplySchedule();
  const pinTask = usePinTask();
  const pinBlock = usePinBlock();
  const updateTask = useUpdateTask();

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reminder = duration <= 0;
  const anchor = recurrence
    ? new Date(recurrence.dtstart)
    : scheduledOn
      ? new Date(scheduledOn)
      : nextRoundHour();
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
    addBlock.isPending ||
    deleteBlock.isPending ||
    clearBlocks.isPending ||
    applySchedule.isPending ||
    pinTask.isPending ||
    pinBlock.isPending ||
    updateTask.isPending;

  const preferred = preferredWindows?.[0];

  const setClock = (hhmm: string) => {
    if (recurrence && draft) {
      if (!hhmm) return;
      onRecurrenceChange(buildRecurrenceInput(draft, applyClockToDate(anchor, hhmm)));
      return;
    }
    if (!hhmm) {
      onScheduledOnChange?.("");
      return;
    }
    const day = scheduledOn
      ? new Date(scheduledOn)
      : startDate
        ? dateFromDateInput(startDate)
        : new Date();
    onScheduledOnChange?.(applyClockToDate(day, hhmm).toISOString());
  };

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
        <>
          <div className="mt-2 flex items-center gap-2 px-1">
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              Time
            </span>
            <TimeField
              className="min-w-0 flex-1"
              value={toTimeInputValue(recurrence.dtstart)}
              clearable={false}
              onChange={setClock}
            />
          </div>
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            {describeRRule(recurrence.rrule, anchor)} at {formatTime(anchor)}.
            {reminder
              ? " Each repeat pings at this time and does not reserve a work block."
              : " Each occurrence starts at this time; auto-schedule will not give the block to other tasks."}
          </p>
        </>
      ) : reminder ? (
        <>
          <div className="mt-2 flex items-center gap-2 px-1">
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              Time
            </span>
            <TimeField
              className="min-w-0 flex-1"
              value={toTimeInputValue(scheduledOn)}
              clearable
              onChange={setClock}
            />
          </div>
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            {scheduledOn
              ? `Pings at ${formatTime(new Date(scheduledOn))}. Use start date for the day.`
              : "Pick a time to show this reminder on the calendar. Use start date for the day."}
          </p>
        </>
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
                : "No ETA yet: this task is not on the calendar."}
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
                    {block.source === "engine" && !block.locked ? (
                      <Sparkles className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <Pin className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate tabular-nums text-foreground">
                      {formatDateTime(start)} – {formatTime(end)}
                      {!isSameDay(start, end) ? ` (${formatDateTime(end)})` : ""}
                    </span>
                    {block.source === "engine" && !block.locked && (
                      <button
                        type="button"
                        aria-label="Pin this time"
                        disabled={pending}
                        onClick={() =>
                          run(() => pinBlock.mutateAsync({ blockId: block.id, locked: true }), "Could not pin block.")
                        }
                        className="rounded px-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Pin
                      </button>
                    )}
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
                disabled={pending}
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

      {!reminder && !completed && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border px-2 py-2">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Engine
              </p>
              <label className="flex items-center gap-2 px-1 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={scheduleLocked}
                  disabled={pending}
                  onChange={(event) =>
                    run(
                      () => pinTask.mutateAsync({ taskId, locked: event.target.checked }),
                      "Could not pin task.",
                    )
                  }
                  className="size-3.5 accent-primary"
                />
                Pin this task (engine will not move it)
              </label>
              <label className="flex items-center gap-2 px-1 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={contiguous}
                  disabled={pending}
                  onChange={(event) =>
                    run(
                      () => updateTask.mutateAsync({ id: taskId, contiguous: event.target.checked }),
                      "Could not update chunking.",
                    )
                  }
                  className="size-3.5 accent-primary"
                />
                Must run in one sitting
              </label>
              <div className="grid grid-cols-2 gap-2 px-1">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Min chunk (min)</span>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    defaultValue={minChunkMinutes || 15}
                    disabled={pending}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value) || value === minChunkMinutes) return;
                      void run(
                        () => updateTask.mutateAsync({ id: taskId, minChunkMinutes: Math.max(5, Math.round(value)) }),
                        "Could not update min chunk.",
                      );
                    }}
                    className="rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Preferred chunk</span>
                  <input
                    type="number"
                    min={0}
                    max={480}
                    defaultValue={preferredChunkMinutes ?? ""}
                    disabled={pending}
                    placeholder="Any"
                    onBlur={(event) => {
                      const raw = event.target.value.trim();
                      const value = raw === "" ? null : Number(raw);
                      if (raw !== "" && !Number.isFinite(value)) return;
                      void run(
                        () =>
                          updateTask.mutateAsync({
                            id: taskId,
                            preferredChunkMinutes: value === null ? null : Math.max(5, Math.round(value)),
                          }),
                        "Could not update preferred chunk.",
                      );
                    }}
                    className="rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 px-1">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">Earliest</span>
                <DateTimeField
                  className="min-w-0 flex-1"
                  value={earliestStartAt}
                  clearable
                  onChange={(iso) =>
                    void run(
                      () => updateTask.mutateAsync({ id: taskId, earliestStartAt: iso || null }),
                      "Could not update earliest start.",
                    )
                  }
                />
              </div>
              <div className="flex items-center gap-2 px-1">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">Prefer</span>
                <div className="w-[6.5 rem] shrink-0">
                  <TimeField
                    value={preferred?.start ?? ""}
                    clearable
                    onChange={(start) => {
                      const end = preferred?.end || "";
                      const windows =
                        start && end ? [{ start, end }] : start ? [{ start, end: start }] : [];
                      void run(
                        () => updateTask.mutateAsync({ id: taskId, preferredWindows: windows }),
                        "Could not update preferred window.",
                      );
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">to</span>
                <div className="w-[6.5 rem] shrink-0">
                  <TimeField
                    value={preferred?.end ?? ""}
                    clearable
                    onChange={(end) => {
                      const start = preferred?.start || "";
                      const windows = start && end ? [{ start, end }] : [];
                      void run(
                        () => updateTask.mutateAsync({ id: taskId, preferredWindows: windows }),
                        "Could not update preferred window.",
                      );
                    }}
                  />
                </div>
              </div>
        </div>
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
