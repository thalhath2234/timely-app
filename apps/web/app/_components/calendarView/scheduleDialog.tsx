"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListTodo, Search, X } from "lucide-react";
import DatePicker, { TimeField } from "@/app/_components/_ui/datePicker";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import Select from "@/app/_components/_ui/select";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { GroupHint, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
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
import { buttonClass } from "@/app/_components/_ui/button";
import { normalizePriority } from "@/app/utils/priority";

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


const DURATION_STEPS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

function durationOptions(current: number) {
  const steps = current > 0 && !DURATION_STEPS.includes(current) ? [...DURATION_STEPS, current].sort((a, b) => a - b) : DURATION_STEPS;
  return steps.map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) }));
}

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

          <SegmentedControl
            fill
            aria-label="Add"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            options={[
              { value: "task", label: "Schedule a task", icon: <ListTodo /> },
              { value: "event", label: "New event", icon: <CalendarDays /> },
            ]}
          />

          {mode === "event" && (
            <ListGroup>
              <input
                autoFocus
                value={title}
                aria-label="Title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Dentist, team stand-up, gym..."
                className="h-10 w-full bg-transparent px-3.5 text-[13px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
              />
            </ListGroup>
          )}

          <div>
            <ListGroup>
              <ListRow label={eventTimeOnly ? "Time" : "When"}>
                {eventTimeOnly ? (
                  <TimeField
                    variant="row"
                    value={toTimeInputValue(when)}
                    clearable={false}
                    aria-label="Time"
                    onChange={(hhmm) =>
                      setWhen(toDatetimeLocalValue(applyClockToDate(startDate, hhmm)))
                    }
                  />
                ) : (
                  <DatePicker
                    variant="row"
                    aria-label="When"
                    mode={mode === "event" && allDay ? "date" : "datetime"}
                    value={when}
                    onChange={setWhen}
                    clearable={false}
                  />
                )}
              </ListRow>
              {!reminderTask ? (
                <ListRow label="Duration">
                  <Select
                    variant="row"
                    aria-label="Duration"
                    value={String(duration)}
                    onChange={(value) => setDuration(Number(value) || 30)}
                    options={durationOptions(duration)}
                  />
                </ListRow>
              ) : null}
              {mode === "event" ? (
                <ListRow label="All day">
                  <ListSwitch label="All day" checked={allDay} onChange={setAllDay} />
                </ListRow>
              ) : null}
              {mode === "event" ? (
                <RecurrenceEditor label="Repeat" value={recurrence} anchor={startDate} onChange={setRecurrence} />
              ) : null}
            </ListGroup>
            {reminderTask ? <GroupHint>Pings at this time. It does not reserve a work block.</GroupHint> : null}
          </div>

          {mode === "task" ? (
            <>
              <div className="flex items-center gap-2 rounded-md border border-input bg-card shadow-xs px-2 py-1.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search unscheduled tasks"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="max-h-56 overflow-y-auto rounded-[12px] border border-border bg-card">
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
                                {normalizePriority(task.priorityLevel) ? ` · ${normalizePriority(task.priorityLevel)}` : ""}
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
                <p className="-mt-2 px-1 text-xs text-muted-foreground">
                  This block covers {formatDuration(duration)} of the{" "}
                  {formatDuration(selectedTask.duration)} estimate. Auto-schedule can fill
                  in the rest.
                </p>
              )}
            </>
          ) : null}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={buttonClass({ variant: "secondary" })}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || (mode === "task" ? !selectedTaskId : !title.trim())}
              className={buttonClass()}
            >
              {pending ? "Saving..." : mode === "task" ? "Schedule" : "Create event"}
            </button>
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
