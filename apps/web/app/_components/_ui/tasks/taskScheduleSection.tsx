"use client";

import { useState } from "react";
import { Pin, Sparkles, X } from "lucide-react";
import { DateTimeField, TimeField } from "@/app/_components/_ui/datePicker";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
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
import { buttonClass } from "@/app/_components/_ui/button";

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


/**
 * Sidebar groups for a task's time on the calendar: the blocks it occupies
 * (or its reminder time), an ETA against the deadline, a one-click
 * auto-schedule, and the engine's preferences. The Repeat row lives in the
 * Dates card (`TaskRepeatRow`).
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
  const [pickAt, setPickAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const incomingPreferStart = preferredWindows?.[0]?.start ?? "";
  const incomingPreferEnd = preferredWindows?.[0]?.end ?? "";
  const [preferStart, setPreferStart] = useState(incomingPreferStart);
  const [preferEnd, setPreferEnd] = useState(incomingPreferEnd);
  // The fields are editable copies of the saved window; when the saved window
  // changes (another client, undo), the copies follow it.
  const [syncedWindow, setSyncedWindow] = useState({ start: incomingPreferStart, end: incomingPreferEnd });
  if (syncedWindow.start !== incomingPreferStart || syncedWindow.end !== incomingPreferEnd) {
    setSyncedWindow({ start: incomingPreferStart, end: incomingPreferEnd });
    setPreferStart(incomingPreferStart);
    setPreferEnd(incomingPreferEnd);
  }

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

  const persistPreferred = (start: string, end: string) => {
    setPreferStart(start);
    setPreferEnd(end);
    const windows = preferredWindowsPayload(start, end);
    if (windows === undefined) {
      if (start && end) setError("Preferred end must be after start.");
      else if (start || end) setError("Set both a start and an end time.");
      return;
    }
    void run(
      () => updateTask.mutateAsync({ id: taskId, preferredWindows: windows }),
      "Could not update preferred window.",
    );
  };

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

  const pinned = (block: ScheduledBlock) => block.locked || block.source !== "engine";

  return (
    <div className="flex flex-col gap-4">
      {recurrence || reminder ? (
        <div>
          <GroupLabel>{reminder ? "Reminder" : "Schedule"}</GroupLabel>
          <ListGroup>
            <ListRow label={reminder && !recurrence ? "Notify at" : "Time"}>
              {recurrence ? (
                <TimeField
                  variant="row"
                  value={toTimeInputValue(recurrence.dtstart)}
                  clearable={false}
                  aria-label="Time"
                  onChange={setClock}
                />
              ) : (
                <DateTimeField
                  variant="row"
                  placeholder="Pick a time"
                  value={scheduledOn}
                  clearable={false}
                  aria-label="Notify at"
                  onChange={(iso) => onScheduledOnChange?.(iso)}
                />
              )}
            </ListRow>
          </ListGroup>
          <GroupHint>
            {recurrence
              ? `${describeRRule(recurrence.rrule, anchor)} at ${formatTime(anchor)}.${
                  reminder
                    ? " Each repeat pings at this time and does not reserve a work block."
                    : " Each occurrence starts at this time; auto-schedule will not give the block to other tasks."
                }`
              : scheduledOn
                ? `Pings at ${formatDateTime(new Date(scheduledOn))}. Does not reserve a work block.`
                : "Pick a date and time to ping. This does not reserve a work block."}
          </GroupHint>
        </div>
      ) : (
        <div>
          <GroupLabel aside={scheduleLocked ? "Pinned" : sorted.length ? `${sorted.length} reserved` : undefined}>Schedule</GroupLabel>
          <ListGroup>
            {sorted.map((block) => {
              const start = new Date(block.start);
              const end = new Date(block.end);
              return (
                <ListRow
                  key={block.id}
                  icon={<Pin className={cn("size-3.5 shrink-0", pinned(block) ? "text-primary" : "text-muted-foreground")} />}
                  label={<span className="tabular-nums">{formatTime(start)} – {formatTime(end)}</span>}
                  meta={`${shortDay(start)}${!isSameDay(start, end) ? ` to ${shortDay(end)}` : ""}${pinned(block) ? " · Pinned" : ""}`}
                >
                  {!pinned(block) ? (
                    <button
                      type="button"
                      aria-label="Pin this time"
                      disabled={pending}
                      onClick={() =>
                        run(() => pinBlock.mutateAsync({ blockId: block.id, locked: true }), "Could not pin block.")
                      }
                      className="cursor-pointer rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-muted"
                    >
                      Pin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove this time"
                    disabled={pending}
                    onClick={() => run(() => deleteBlock.mutateAsync(block.id), "Could not remove block.")}
                    className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </ListRow>
              );
            })}
            {!completed && adding ? (
              <ListRow key="__pick" label="Starts">
                <DateTimeField variant="row" aria-label="New time" value={pickAt || null} clearable={false} onChange={setPickAt} />
                <button
                  type="button"
                  disabled={pending || !pickAt}
                  onClick={() =>
                    run(async () => {
                      await addBlock.mutateAsync({
                        taskId,
                        start: pickAt,
                        durationMinutes: Math.max(15, duration || 30),
                      });
                      setAdding(false);
                      setPickAt("");
                    }, "Could not add block.")
                  }
                  className={buttonClass({ size: "sm" })}
                >
                  Add
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  onClick={() => {
                    setAdding(false);
                    setPickAt("");
                  }}
                  className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </ListRow>
            ) : null}
            {!completed && !adding ? (
              <ListRow
                key="__add"
                tone="add"
                label="Add time"
                onClick={() => {
                  setPickAt(nextRoundHour().toISOString());
                  setAdding(true);
                }}
              />
            ) : null}
            {!completed ? (
              <ListRow
                key="__auto"
                tone="add"
                icon={<Sparkles className="size-4 shrink-0 text-primary" />}
                label={applySchedule.isPending ? "Scheduling…" : "Auto-schedule"}
                onClick={() => {
                  if (pending) return;
                  void run(async () => {
                    const plan = await applySchedule.mutateAsync({ taskIds: [taskId] });
                    const skipped = plan.skipped?.find((item) => item.taskId === taskId);
                    if (skipped) {
                      throw new Error(skipped.message || "Could not auto-schedule this task.");
                    }
                    if (!plan.proposals?.some((item) => item.taskId === taskId)) {
                      throw new Error("The engine did not place this task.");
                    }
                  }, "Could not auto-schedule.");
                }}
              />
            ) : null}
            {!completed && sorted.length > 0 ? (
              <ListRow
                key="__clear"
                tone="danger"
                label="Clear all time"
                onClick={() => {
                  if (pending) return;
                  void run(() => clearBlocks.mutateAsync(taskId), "Could not unschedule.");
                }}
              />
            ) : null}
          </ListGroup>
          {!completed ? (
            <GroupHint className={lateEta ? "text-destructive" : undefined}>
              {eta
                ? `ETA ${formatDateTime(eta)}${lateEta ? ", after the deadline" : ""}`
                : "Not on the calendar yet."}
              {eta && duration > plannedMinutes
                ? ` ${formatDuration(duration - plannedMinutes)} still unplanned.`
                : eta
                  ? "."
                  : ""}
            </GroupHint>
          ) : null}
        </div>
      )}

      {error && <p className="-mt-2 px-1 text-xs text-destructive">{error}</p>}

      {!reminder && !completed && (
        <div>
          <GroupLabel>Auto-schedule</GroupLabel>
          <ListGroup>
            <ListRow label="Pin task" meta="Auto-schedule will not move it">
              <ListSwitch
                label="Pin task"
                checked={scheduleLocked}
                disabled={pending}
                onChange={(locked) => run(() => pinTask.mutateAsync({ taskId, locked }), "Could not pin task.")}
              />
            </ListRow>
            <ListRow label="One sitting" meta="Place it as one block">
              <ListSwitch
                label="One sitting"
                checked={contiguous}
                disabled={pending}
                onChange={(next) =>
                  run(() => updateTask.mutateAsync({ id: taskId, contiguous: next }), "Could not update chunking.")
                }
              />
            </ListRow>
            <ListRow label="Minimum chunk">
              <SegmentedControl
                size="sm"
                className="*:px-2"
                aria-label="Minimum chunk"
                value={String(minChunkMinutes || 15)}
                options={[15, 30, 45, 60].map((minutes) => ({ value: String(minutes), label: `${minutes}m` }))}
                onChange={(next) =>
                  run(
                    () => updateTask.mutateAsync({ id: taskId, minChunkMinutes: Number(next) }),
                    "Could not update min chunk.",
                  )
                }
              />
            </ListRow>
            <ListRow label="Preferred chunk">
              <SegmentedControl
                size="sm"
                className="*:px-2"
                aria-label="Preferred chunk"
                value={preferredChunkMinutes ? String(preferredChunkMinutes) : "any"}
                options={[
                  { value: "any", label: "Any" },
                  ...[30, 60, 90].map((minutes) => ({ value: String(minutes), label: `${minutes}m` })),
                ]}
                onChange={(next) =>
                  run(
                    () =>
                      updateTask.mutateAsync({
                        id: taskId,
                        // 0 clears the preference; the server ignores null.
                        preferredChunkMinutes: next === "any" ? 0 : Number(next),
                      }),
                    "Could not update preferred chunk.",
                  )
                }
              />
            </ListRow>
            <ListRow label="Earliest start">
              <DateTimeField
                variant="row"
                placeholder="Any time"
                aria-label="Earliest start"
                value={earliestStartAt}
                clearable
                onChange={(iso) =>
                  void run(
                    () => updateTask.mutateAsync({ id: taskId, earliestStartAt: iso || "" }),
                    "Could not update earliest start.",
                  )
                }
              />
            </ListRow>
            <ListRow label="Work hours">
              <TimeField
                variant="row"
                placeholder="Any"
                value={preferStart}
                clearable
                aria-label="Work from"
                onChange={(start) => persistPreferred(start, preferEnd)}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <TimeField
                variant="row"
                placeholder="Any"
                value={preferEnd}
                clearable
                aria-label="Work until"
                onChange={(end) => persistPreferred(preferStart, end)}
              />
            </ListRow>
          </ListGroup>
        </div>
      )}
    </div>
  );
}

/**
 * The task's Repeat row, for the Dates card. A new rule starts from the
 * reminder time, or the next round hour, so the first occurrence is soon.
 */
export function TaskRepeatRow({
  recurrence,
  scheduledOn,
  onRecurrenceChange,
}: {
  recurrence: RecurrenceRule | null | undefined;
  scheduledOn?: string | null;
  onRecurrenceChange: (recurrence: RecurrenceInput | null) => void;
}) {
  const anchor = recurrence ? new Date(recurrence.dtstart) : scheduledOn ? new Date(scheduledOn) : nextRoundHour();
  const draft: RecurrenceDraft | null = recurrence ? rruleToDraft(recurrence.rrule, anchor) : null;
  return (
    <RecurrenceEditor
      label="Repeat"
      value={draft}
      anchor={anchor}
      onChange={(next) => onRecurrenceChange(buildRecurrenceInput(next, anchor))}
    />
  );
}

function shortDay(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function nextRoundHour(): Date {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `undefined` means the clocks are incomplete or inverted — do not persist yet. */
function preferredWindowsPayload(
  start: string,
  end: string,
): PreferredWindow[] | undefined {
  if (!start && !end) return [];
  if (!start || !end) return undefined;
  const startMin = clockMinutes(start);
  const endMin = clockMinutes(end);
  if (startMin == null || endMin == null || endMin <= startMin) return undefined;
  return [{ start, end }];
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}
