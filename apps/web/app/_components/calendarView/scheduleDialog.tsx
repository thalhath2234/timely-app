"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListTodo, Repeat, Search, X } from "lucide-react";
import DatePicker, { TimeField } from "@/app/_components/_ui/datePicker";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import { Task } from "@/app/_types/types";
import {
  applyClockToDate,
  formatDuration,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  toTimeInputValue,
} from "@/app/utils/calendar";
import { buildRecurrenceInput, type RecurrenceDraft } from "@/app/utils/recurrence";
import { useAddTaskBlock, useCreateEvent } from "@/app/utils/hooks/calendar";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { cn } from "@/app/utils/cn";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { isUnscheduled } from "@timely/contract/workStatus";
import { useWorkingHoursZone } from "@/app/utils/hooks/workspaces";

export type ScheduleSlot = {
  at: Date;
  durationMinutes?: number;
  /** Which tab opens first. */
  mode?: ScheduleMode;
};

type ScheduleMode = "task" | "event";

type ScheduleDialogProps = {
  slot: ScheduleSlot | null;
  tasks: Task[];
  onClose: () => void;
  onScheduled?: (taskId: string) => void;
};

const fieldClass =
  "w-full rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40";

export default function ScheduleDialog({
  slot,
  tasks,
  onClose,
  onScheduled,
}: ScheduleDialogProps) {
  useEffect(() => {
    if (!slot) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slot, onClose]);

  return slot ? (
    <ScheduleDialogPanel
      key={slot.at.toISOString()}
      slot={slot}
      tasks={tasks}
      onClose={onClose}
      onScheduled={onScheduled}
    />
  ) : null;
}

function ScheduleDialogPanel({
  slot,
  tasks,
  onClose,
  onScheduled,
}: {
  slot: ScheduleSlot;
  tasks: Task[];
  onClose: () => void;
  onScheduled?: (taskId: string) => void;
}) {
  const addBlock = useAddTaskBlock();
  const createEvent = useCreateEvent();
  const updateTask = useUpdateTask();
  const timeZone = useWorkingHoursZone();

  const [mode, setMode] = useState<ScheduleMode>(slot.mode ?? "task");
  const [when, setWhen] = useState(() => toDatetimeLocalValue(slot.at));
  // `null` means "not overridden": the field then follows the picked task's
  // estimate so one block covers the work by default.
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Task tab
  const [search, setSearch] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");

  // Event tab
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft | null>(null);

  const startDate = useMemo(
    () => (when ? new Date(fromDatetimeLocalValue(when)) : slot.at),
    [when, slot.at],
  );

  const unscheduled = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (tasks ?? [])
      .filter((task) => isUnscheduled(task, timeZone))
      .filter(
        (task) =>
          !query ||
          task.name.toLowerCase().includes(query) ||
          task.project?.title?.toLowerCase().includes(query),
      )
      .slice(0, 40);
  }, [tasks, search, timeZone]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const reminderTask = mode === "task" && Boolean(selectedTask) && (selectedTask?.duration ?? 0) <= 0;
  const duration =
    durationOverride ??
    (mode === "task" && selectedTask && selectedTask.duration > 0
      ? selectedTask.duration
      : (slot.durationMinutes ?? 30));
  const setDuration = setDurationOverride;

  const pending = addBlock.isPending || createEvent.isPending || updateTask.isPending;
  const eventTimeOnly = mode === "event" && Boolean(recurrence) && !allDay;

  const submit = async () => {
    if (!when) {
      setError("Choose a date and time.");
      return;
    }
    const minutes = Math.max(15, duration || 30);
    const end = new Date(startDate.getTime() + minutes * 60_000);
    setError(null);

    try {
      if (mode === "task") {
        if (!selectedTaskId) {
          setError("Pick a task to schedule.");
          return;
        }
        if (reminderTask) {
          await updateTask.mutateAsync({
            id: selectedTaskId,
            scheduledOn: startDate.toISOString(),
          });
        } else {
          await addBlock.mutateAsync({
            taskId: selectedTaskId,
            start: startDate.toISOString(),
            end: end.toISOString(),
          });
        }
        onScheduled?.(selectedTaskId);
      } else {
        if (!title.trim()) {
          setError("Give the event a title.");
          return;
        }
        await createEvent.mutateAsync({
          title: title.trim(),
          start: startDate.toISOString(),
          end: end.toISOString(),
          allDay,
          recurrence: buildRecurrenceInput(recurrence, startDate) ?? undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "task"
            ? "Could not schedule task."
            : "Could not create event.",
      );
    }
  };

  return (
    <>
      <OverlayScrim
        className="z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={onClose}
      />
      <OverlayFrame className="z-50 items-center justify-center p-4">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label="Add to calendar"
          className="relative flex w-full max-w-md flex-col gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>

          <div className="pr-8">
            <h2 className="text-base font-semibold text-foreground">Add to calendar</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Place a task by hand, or create an event that blocks the time.
            </p>
          </div>

          <div className="flex gap-1 rounded-lg bg-muted/40 p-1" role="tablist">
            {(
              [
                { value: "task", label: "Schedule a task", icon: ListTodo },
                { value: "event", label: "New event", icon: CalendarDays },
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={mode === tab.value}
                onClick={() => {
                  setMode(tab.value);
                  setError(null);
                }}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  mode === tab.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="size-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {mode === "event" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Title</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Dentist, team stand-up, gym..."
                className={fieldClass}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {eventTimeOnly ? "Time" : "When"}
              </span>
              {eventTimeOnly ? (
                <TimeField
                  value={toTimeInputValue(when)}
                  clearable={false}
                  aria-label="Time"
                  onChange={(hhmm) =>
                    setWhen(toDatetimeLocalValue(applyClockToDate(startDate, hhmm)))
                  }
                />
              ) : (
                <DatePicker
                  mode={mode === "event" && allDay ? "date" : "datetime"}
                  value={when}
                  onChange={setWhen}
                  clearable={false}
                />
              )}
            </label>

            {reminderTask ? (
              <p className="flex flex-col justify-end text-xs text-muted-foreground">
                Reminder — pings at this time, no work block.
              </p>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Duration ({formatDuration(Math.max(15, duration || 30))})
                </span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value) || 30)}
                  className={fieldClass}
                />
              </label>
            )}
          </div>

          {mode === "task" ? (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-input/30 px-2 py-1.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search unscheduled tasks"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                {unscheduled.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No unscheduled open tasks
                    {search ? ` matching “${search}”` : ""}.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {unscheduled.map((task) => {
                      const selected = task.id === selectedTaskId;
                      return (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedTaskId(task.id)}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                              selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {task.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {task.project?.title ?? task.workspace?.name ?? "No project"}
                                {task.priorityLevel ? ` · ${task.priorityLevel}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {task.duration > 0 ? formatDuration(task.duration) : "Reminder"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {selectedTask && selectedTask.duration > duration && (
                <p className="text-[11px] text-muted-foreground">
                  This block covers {formatDuration(duration)} of the{" "}
                  {formatDuration(selectedTask.duration)} estimate. Auto-schedule can fill
                  in the rest.
                </p>
              )}
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
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
                  value={recurrence}
                  anchor={startDate}
                  onChange={setRecurrence}
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg bg-secondary px-3 py-1.5 font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || (mode === "task" ? !selectedTaskId : !title.trim())}
              className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {pending ? "Saving..." : mode === "task" ? "Schedule" : "Create event"}
            </button>
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
