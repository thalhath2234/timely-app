"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Pin, Repeat, Sparkles, X } from "lucide-react";
import DatePicker, { TimeField } from "@/app/_components/_ui/datePicker";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import {
  applyClockToDate,
  formatDateTime,
  formatDuration,
  fromDatetimeLocalValue,
  swatchColor,
  toDatetimeLocalValue,
  toTimeInputValue,
  type CalendarEvent,
} from "@/app/utils/calendar";
import {
  buildRecurrenceInput,
  describeRRule,
  rruleToDraft,
  withTimeOfDay,
  withUntil,
  type RecurrenceDraft,
} from "@/app/utils/recurrence";
import { browserTimezone } from "@/app/utils/api/schedule";
import {
  useClearTaskBlocks,
  useDeleteBlock,
  useDeleteEvent,
  useEditEventOccurrence,
  useMoveBlock,
  useSplitEventSeries,
  useUpdateEvent,
} from "@/app/utils/hooks/calendar";
import {
  useEditTaskOccurrence,
  useSplitTaskSeries,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";

type EventDialogProps = {
  event: CalendarEvent | null;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
};

/** Which instances a change to a series applies to. */
type Scope = "this" | "future" | "all";

const SCOPE_OPTIONS: { value: Scope; label: string; hint: string }[] = [
  { value: "this", label: "This occurrence", hint: "Only this date changes." },
  {
    value: "future",
    label: "This and following",
    hint: "Ends the series here and starts a new one.",
  },
  { value: "all", label: "All occurrences", hint: "Updates the whole series." },
];

const primaryButton =
  "cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60";
const secondaryButton =
  "inline-flex cursor-pointer items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-60";
const dangerButton =
  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60";
const fieldClass =
  "w-full rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40";

export default function EventDialog({ event, onClose, onOpenTask }: EventDialogProps) {
  useEffect(() => {
    if (!event) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, onClose]);

  return event ? (
    <DialogFrame key={event.id} event={event} onClose={onClose}>
      {event.kind === "task" && (
        <TaskBlockPanel event={event} onClose={onClose} onOpenTask={onOpenTask} />
      )}
      {event.kind === "taskOccurrence" && (
        <TaskOccurrencePanel
          event={event}
          onClose={onClose}
          onOpenTask={onOpenTask}
        />
      )}
      {(event.kind === "event" || event.kind === "eventOccurrence") && (
        <EventPanel event={event} onClose={onClose} />
      )}
    </DialogFrame>
  ) : null;
}

function DialogFrame({
  event,
  onClose,
  children,
}: {
  event: CalendarEvent;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const badge =
    event.reminder
      ? { icon: Clock, label: "Reminder" }
      : event.kind === "task"
        ? event.source === "engine"
          ? { icon: Sparkles, label: "Auto-scheduled" }
          : { icon: Pin, label: "Pinned" }
        : event.kind === "taskOccurrence" || event.kind === "eventOccurrence"
          ? { icon: Repeat, label: event.kind === "taskOccurrence" ? "Repeating task" : "Repeating event" }
          : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <OverlayScrim
        className="bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={onClose}
      />
      <OverlayPanel
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        className="relative flex w-full max-w-sm flex-col gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col gap-2 pr-8">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: swatchColor(event.color) }}
            />
            <h2 className="text-base font-medium leading-none">{event.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {event.statusName && (
              <span className="inline-flex items-center rounded-4xl border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {event.statusName}
              </span>
            )}
            {badge && (
              <span className="inline-flex items-center gap-1 rounded-4xl border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                <badge.icon className="size-3" />
                {badge.label}
              </span>
            )}
            {event.kind === "task" && event.chunkCount > 1 && (
              <span className="inline-flex items-center rounded-4xl border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Part {event.chunkIndex + 1} of {event.chunkCount}
              </span>
            )}
            {event.moved && (
              <span className="inline-flex items-center rounded-4xl border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Moved
              </span>
            )}
          </div>
        </div>

        {children}
      </OverlayPanel>
    </div>
  );
}

function TaskDetails({ event }: { event: CalendarEvent }) {
  const task = event.task;
  if (!task) return null;

  const details = [
    { label: "Type", value: event.reminder ? "Reminder" : null },
    { label: "Project", value: task.project?.title },
    { label: "Workspace", value: task.workspace?.name },
    { label: "Priority", value: task.priorityLevel },
    {
      label: "Deadline",
      value: task.deadline
        ? new Date(task.deadline).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null,
    },
  ].filter((detail) => Boolean(detail.value));

  return (
    <>
      {task.description && (
        <>
          <div className="h-px bg-border" />
          <p className="line-clamp-4 text-sm text-muted-foreground">
            {task.description}
          </p>
        </>
      )}

      {details.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <dl className="flex flex-col gap-2">
            {details.map((detail) => (
              <div key={detail.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                <dd className="truncate text-sm">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {task.labels && task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-4xl border px-2 py-0.5 text-xs font-normal"
              style={{
                backgroundColor: `${label.color}1a`,
                borderColor: `${label.color}66`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function ScopePicker({
  value,
  onChange,
  allowFuture = true,
}: {
  value: Scope;
  onChange: (scope: Scope) => void;
  allowFuture?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-2">
      <legend className="px-1 text-xs text-muted-foreground">Apply to</legend>
      {SCOPE_OPTIONS.filter((option) => allowFuture || option.value !== "future").map(
        (option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="radio"
              name="scope"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="font-medium text-foreground">{option.label}</span>
              <span className="block text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ),
      )}
    </fieldset>
  );
}

function TimeFields({
  when,
  duration,
  onWhen,
  onDuration,
  label = "Scheduled",
  reminder = false,
  timeOnly = false,
}: {
  when: string;
  duration: number;
  onWhen: (value: string) => void;
  onDuration: (value: number) => void;
  label?: string;
  reminder?: boolean;
  timeOnly?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {timeOnly ? (
          <TimeField
            value={toTimeInputValue(when)}
            clearable={false}
            aria-label={label}
            onChange={(hhmm) => {
              const day = when ? new Date(fromDatetimeLocalValue(when)) : new Date();
              onWhen(toDatetimeLocalValue(applyClockToDate(day, hhmm)));
            }}
          />
        ) : (
          <DatePicker mode="datetime" value={when} onChange={onWhen} clearable={false} />
        )}
      </label>

      {reminder ? (
        <p className="text-xs text-muted-foreground">
          Reminder — pings at this time, no work block.
        </p>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Duration ({formatDuration(duration)})
          </span>
          <input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(input) => onDuration(Number(input.target.value) || 30)}
            className={fieldClass}
          />
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* One block of a one-off task                                              */
/* ------------------------------------------------------------------------ */

function TaskBlockPanel({
  event,
  onClose,
  onOpenTask,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const moveBlock = useMoveBlock();
  const deleteBlock = useDeleteBlock();
  const clearBlocks = useClearTaskBlocks();
  const updateTask = useUpdateTask();
  const [when, setWhen] = useState(() => toDatetimeLocalValue(event.start));
  const [duration, setDuration] = useState(event.durationMinutes);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const reminder = event.reminder;
  const pending =
    moveBlock.isPending ||
    deleteBlock.isPending ||
    clearBlocks.isPending ||
    updateTask.isPending;

  const save = async () => {
    if (!when) {
      setError("Choose a date and time.");
      return;
    }
    const start = new Date(fromDatetimeLocalValue(when));
    try {
      if (reminder && event.task) {
        await updateTask.mutateAsync({
          id: event.task.id,
          scheduledOn: start.toISOString(),
        });
      } else if (event.blockId) {
        await moveBlock.mutateAsync({
          blockId: event.blockId,
          start: start.toISOString(),
          end: new Date(start.getTime() + Math.max(15, duration) * 60_000).toISOString(),
        });
      } else {
        setError("Choose a date and time.");
        return;
      }
      setDirty(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  };

  const remove = async () => {
    if (reminder && event.task) {
      try {
        await updateTask.mutateAsync({ id: event.task.id, scheduledOn: "" });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not clear reminder.");
      }
      return;
    }
    if (!event.blockId) return;
    try {
      await deleteBlock.mutateAsync(event.blockId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove block.");
    }
  };

  const unschedule = async () => {
    if (!event.task) return;
    try {
      if (reminder) {
        await updateTask.mutateAsync({ id: event.task.id, scheduledOn: "" });
      } else {
        await clearBlocks.mutateAsync(event.task.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unschedule task.");
    }
  };

  return (
    <>
      <TimeFields
        when={when}
        duration={duration}
        reminder={reminder}
        label={reminder ? "Reminder" : "Scheduled"}
        onWhen={(next) => {
          setWhen(next);
          setDirty(true);
        }}
        onDuration={(next) => {
          setDuration(next);
          setDirty(true);
        }}
      />
      {event.source === "engine" && dirty && (
        <p className="text-[11px] text-muted-foreground">
          Moving this block pins it; the auto-scheduler will not move it again.
        </p>
      )}

      <TaskDetails event={event} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => event.task && onOpenTask?.(event.task.id)}
          className={secondaryButton}
        >
          Open task
        </button>
        <button type="button" onClick={remove} disabled={pending} className={dangerButton}>
          {reminder
            ? "Clear reminder"
            : event.chunkCount > 1
              ? "Remove this block"
              : "Remove from calendar"}
        </button>
        {event.chunkCount > 1 && (
          <button type="button" onClick={unschedule} disabled={pending} className={dangerButton}>
            Unschedule all
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={cn(primaryButton, "ml-auto")}
        >
          {moveBlock.isPending || updateTask.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* One occurrence of a recurring task                                       */
/* ------------------------------------------------------------------------ */

function TaskOccurrencePanel({
  event,
  onClose,
  onOpenTask,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const editOccurrence = useEditTaskOccurrence();
  const splitSeries = useSplitTaskSeries();
  const updateTask = useUpdateTask();
  const task = event.task;
  const rule = task?.recurrence ?? null;

  const [when, setWhen] = useState(() => toDatetimeLocalValue(event.start));
  const [duration, setDuration] = useState(event.durationMinutes);
  const [scope, setScope] = useState<Scope>("this");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = editOccurrence.isPending || splitSeries.isPending || updateTask.isPending;

  const originalStart = event.originalStart ?? event.start;
  const anchor = rule ? new Date(rule.dtstart) : originalStart;
  const isFirst = rule ? originalStart.getTime() <= new Date(rule.dtstart).getTime() : true;
  const completed = Boolean(event.completedAt);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  const toggleComplete = () =>
    run(
      () =>
        editOccurrence.mutateAsync({
          id: task!.id,
          originalStart: originalStart.toISOString(),
          action: completed ? "uncomplete" : "complete",
        }),
      "Could not update occurrence.",
    );

  const skip = () =>
    run(
      () =>
        editOccurrence.mutateAsync({
          id: task!.id,
          originalStart: originalStart.toISOString(),
          action: "skip",
        }),
      "Could not skip occurrence.",
    );

  const restore = () =>
    run(
      () =>
        editOccurrence.mutateAsync({
          id: task!.id,
          originalStart: originalStart.toISOString(),
          action: "restore",
        }),
      "Could not restore occurrence.",
    );

  const endSeriesHere = () =>
    run(
      () =>
        updateTask.mutateAsync({
          id: task!.id,
          recurrence: {
            rrule: withUntil(rule!.rrule, originalStart),
            dtstart: rule!.dtstart,
            timezone: rule!.timezone,
          },
        }),
      "Could not end series.",
    );

  const save = () => {
    if (!task || !rule || !when) return;
    const newStart = new Date(fromDatetimeLocalValue(when));
    const reminder = event.reminder;
    const newEnd = reminder
      ? newStart
      : new Date(newStart.getTime() + Math.max(15, duration) * 60_000);
    const nextDuration = reminder ? 0 : Math.max(15, duration);

    if (scope === "this") {
      return run(
        () =>
          editOccurrence.mutateAsync({
            id: task.id,
            originalStart: originalStart.toISOString(),
            action: "move",
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
          }),
        "Could not move occurrence.",
      );
    }
    if (scope === "future") {
      return run(
        () =>
          splitSeries.mutateAsync({
            id: task.id,
            fromStart: originalStart.toISOString(),
            recurrence: {
              rrule: rule.rrule,
              dtstart: newStart.toISOString(),
              timezone: rule.timezone || browserTimezone(),
            },
            duration: nextDuration,
          }),
        "Could not update series.",
      );
    }
    // All: keep the series start date, change the time of day and duration.
    return run(
      () =>
        updateTask.mutateAsync({
          id: task.id,
          duration: nextDuration,
          recurrence: {
            rrule: rule.rrule,
            dtstart: withTimeOfDay(new Date(rule.dtstart), newStart).toISOString(),
            timezone: rule.timezone || browserTimezone(),
          },
        }),
      "Could not update series.",
    );
  };

  if (!task) return null;

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {describeRRule(rule?.rrule, anchor)}
        {completed && event.completedAt
          ? ` · Done ${formatDateTime(event.completedAt)}`
          : ""}
      </p>

      <TimeFields
        when={when}
        duration={duration}
        reminder={event.reminder}
        onWhen={(next) => {
          setWhen(next);
          setDirty(true);
        }}
        onDuration={(next) => {
          setDuration(next);
          setDirty(true);
        }}
        label="This occurrence"
      />

      {dirty && <ScopePicker value={scope} onChange={setScope} allowFuture={!isFirst} />}

      <TaskDetails event={event} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleComplete}
          disabled={pending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
            completed
              ? "bg-success/15 text-success hover:bg-success/25"
              : "bg-foreground text-background hover:opacity-90",
          )}
        >
          <Check className="size-3.5" />
          {completed ? "Done" : "Mark done"}
        </button>
        <button type="button" onClick={() => onOpenTask?.(task.id)} className={secondaryButton}>
          Open series
        </button>
        {event.moved ? (
          <button type="button" onClick={restore} disabled={pending} className={secondaryButton}>
            Restore time
          </button>
        ) : (
          <button type="button" onClick={skip} disabled={pending} className={dangerButton}>
            Skip
          </button>
        )}
        {!isFirst && (
          <button type="button" onClick={endSeriesHere} disabled={pending} className={dangerButton}>
            End series here
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={cn(primaryButton, "ml-auto")}
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Standalone event, one-off or one occurrence of a series                  */
/* ------------------------------------------------------------------------ */

function EventPanel({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const editOccurrence = useEditEventOccurrence();
  const splitSeries = useSplitEventSeries();
  const entity = event.event;
  const rule = entity?.recurrence ?? null;
  const isOccurrence = event.kind === "eventOccurrence";

  const originalStart = event.originalStart ?? event.start;
  const seriesAnchor = useMemo(
    () => (rule ? new Date(rule.dtstart) : new Date(entity?.start ?? event.start)),
    [rule, entity?.start, event.start],
  );
  const isFirst = rule ? originalStart.getTime() <= seriesAnchor.getTime() : true;

  const [title, setTitle] = useState(event.title);
  const [when, setWhen] = useState(() => toDatetimeLocalValue(event.start));
  const [duration, setDuration] = useState(event.durationMinutes);
  const [allDay, setAllDay] = useState(event.allDay);
  const [draft, setDraft] = useState<RecurrenceDraft | null>(() =>
    rule ? rruleToDraft(rule.rrule, seriesAnchor) : null,
  );
  const [scope, setScope] = useState<Scope>("this");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteScope, setDeleteScope] = useState<Scope>("this");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending =
    updateEvent.isPending ||
    deleteEvent.isPending ||
    editOccurrence.isPending ||
    splitSeries.isPending;

  const recurrenceChanged = useMemo(() => {
    const before = rule?.rrule ?? null;
    const after = draft ? buildRecurrenceInput(draft, seriesAnchor)?.rrule ?? null : null;
    return before !== after;
  }, [draft, rule?.rrule, seriesAnchor]);

  // Title / recurrence edits only make sense for the whole series.
  const seriesOnlyChange = title !== event.title || recurrenceChanged || allDay !== event.allDay;
  const effectiveScope: Scope = !isOccurrence ? "all" : seriesOnlyChange ? "all" : scope;

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  const save = () => {
    if (!entity) return;
    if (!title.trim()) {
      setError("Give the event a title.");
      return;
    }
    if (!when) {
      setError("Choose a date and time.");
      return;
    }
    const newStart = new Date(fromDatetimeLocalValue(when));
    const newEnd = new Date(newStart.getTime() + Math.max(15, duration) * 60_000);

    if (effectiveScope === "this") {
      return run(
        () =>
          editOccurrence.mutateAsync({
            id: entity.id,
            originalStart: originalStart.toISOString(),
            action: "move",
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
          }),
        "Could not move occurrence.",
      );
    }

    if (effectiveScope === "future" && rule) {
      return run(
        () =>
          splitSeries.mutateAsync({
            id: entity.id,
            fromStart: originalStart.toISOString(),
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
            title: title.trim(),
            recurrence: {
              rrule: rule.rrule,
              timezone: rule.timezone || browserTimezone(),
            },
          }),
        "Could not update series.",
      );
    }

    // Whole event / whole series. For a series the anchor keeps its date and
    // takes the new time of day; a one-off simply moves.
    const start = isOccurrence ? withTimeOfDay(seriesAnchor, newStart) : newStart;
    const end = new Date(start.getTime() + Math.max(15, duration) * 60_000);
    return run(
      () =>
        updateEvent.mutateAsync({
          id: entity.id,
          title: title.trim(),
          start: start.toISOString(),
          end: end.toISOString(),
          allDay,
          recurrence: draft ? buildRecurrenceInput(draft, start) : null,
        }),
      "Could not save event.",
    );
  };

  const remove = () => {
    if (!entity) return;
    if (!isOccurrence || deleteScope === "all") {
      return run(() => deleteEvent.mutateAsync(entity.id), "Could not delete event.");
    }
    if (deleteScope === "this") {
      return run(
        () =>
          editOccurrence.mutateAsync({
            id: entity.id,
            originalStart: originalStart.toISOString(),
            action: "skip",
          }),
        "Could not skip occurrence.",
      );
    }
    return run(
      () =>
        updateEvent.mutateAsync({
          id: entity.id,
          recurrence: {
            rrule: withUntil(rule!.rrule, originalStart),
            dtstart: rule!.dtstart,
            timezone: rule!.timezone,
          },
        }),
      "Could not end series.",
    );
  };

  const restore = () =>
    run(
      () =>
        editOccurrence.mutateAsync({
          id: entity!.id,
          originalStart: originalStart.toISOString(),
          action: "restore",
        }),
      "Could not restore occurrence.",
    );

  if (!entity) return null;

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(input) => {
            setTitle(input.target.value);
            setDirty(true);
          }}
          className={fieldClass}
        />
      </label>

      <TimeFields
        when={when}
        duration={duration}
        timeOnly={Boolean(draft || rule) && !allDay && effectiveScope !== "this"}
        onWhen={(next) => {
          setWhen(next);
          setDirty(true);
        }}
        onDuration={(next) => {
          setDuration(next);
          setDirty(true);
        }}
        label={
          isOccurrence && effectiveScope === "this"
            ? "This occurrence"
            : Boolean(draft || rule) && !allDay
              ? "Time"
              : "Starts"
        }
      />

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(input) => {
            setAllDay(input.target.checked);
            setDirty(true);
          }}
          className="size-3.5 accent-primary"
        />
        All day
      </label>

      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Repeat className="size-3" />
          Repeat
        </span>
        <RecurrenceEditor
          value={draft}
          anchor={seriesAnchor}
          onChange={(next) => {
            setDraft(next);
            setDirty(true);
          }}
        />
      </div>

      {isOccurrence && dirty && !seriesOnlyChange && (
        <ScopePicker value={scope} onChange={setScope} allowFuture={!isFirst} />
      )}
      {isOccurrence && dirty && seriesOnlyChange && (
        <p className="text-[11px] text-muted-foreground">
          Title and repeat changes apply to every occurrence.
        </p>
      )}

      {entity.description && (
        <>
          <div className="h-px bg-border" />
          <p className="line-clamp-4 text-sm text-muted-foreground">{entity.description}</p>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2">
          {isOccurrence && (
            <ScopePicker value={deleteScope} onChange={setDeleteScope} allowFuture={!isFirst} />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="ml-auto cursor-pointer rounded-lg bg-destructive-container px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive-container/90 disabled:opacity-60"
            >
              {pending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            className={dangerButton}
          >
            Delete
          </button>
          {event.moved && (
            <button type="button" onClick={restore} disabled={pending} className={secondaryButton}>
              Restore time
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className={cn(primaryButton, "ml-auto")}
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </>
  );
}
