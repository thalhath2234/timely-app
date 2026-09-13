"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Sun } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import EventDialog from "@/app/_components/calendarView/eventDialog";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { addCalendarDays, toCalendarEvents, type CalendarEvent } from "@/app/utils/calendar";
import { useToday } from "@/app/utils/hooks/calendar";
import {
  useInboxTasks,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { showUndoToast } from "@/app/_store/toastStore";
import type { CalendarItem, Task } from "@/app/_types/types";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Ticks once a second while a focus session is running. */
function useElapsedSeconds(startedAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return 0;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

function TaskRow({
  task,
  onOpen,
  extra,
}: {
  task: Task;
  onOpen: () => void;
  extra?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-accent/40"
    >
      <span className="truncate">{task.name}</span>
      {extra ? <span className="text-xs text-muted-foreground">{extra}</span> : null}
    </button>
  );
}

function FocusingPanel({
  task,
  onOpen,
  onStop,
  onDone,
  busy,
}: {
  task: Task;
  onOpen: () => void;
  onStop: () => void;
  onDone: () => void;
  busy: boolean;
}) {
  const elapsed = useElapsedSeconds(task.focusStartedAt);
  const priorMinutes = task.actualMinutes ?? 0;
  const estimate = task.duration > 0 ? task.duration : null;
  const totalMinutes = priorMinutes + Math.floor(elapsed / 60);
  const overEstimate = estimate != null && totalMinutes > estimate;

  return (
    <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focusing</p>
        <span
          className={`text-lg font-semibold tabular-nums ${overEstimate ? "text-destructive" : "text-foreground"}`}
          aria-live="off"
          title="Elapsed in this session"
        >
          {formatElapsed(elapsed)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="min-w-0 flex-1 truncate text-left font-medium" onClick={onOpen}>
          {task.name}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/calendar?taskId=${encodeURIComponent(task.id)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent/40"
          >
            <CalendarClock className="size-3.5" /> Reschedule
          </Link>
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent/40 disabled:opacity-60"
            onClick={onDone}
          >
            <Check className="size-3.5" /> Done
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-60"
            onClick={onStop}
          >
            Stop
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {priorMinutes > 0 ? `${priorMinutes}m focused before this session` : "First focus session"}
        {estimate != null ? ` · estimate ${estimate}m` : ""}
        {overEstimate ? " · over estimate" : ""}
      </p>
    </section>
  );
}

export default function TodayPage() {
  const today = useToday();
  const inbox = useInboxTasks();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const updateTask = useUpdateTask();
  const openTask = useEntityDetailStore((state) => state.openTask);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const data = today.data;
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const scheduled = useMemo(() => items.filter((item) => !item.reminder), [items]);
  const reminders = useMemo(() => items.filter((item) => item.reminder), [items]);

  // Standalone events and reminders open the same dialog the calendar uses;
  // task-backed rows open the task detail panel.
  const calendarEvents = useMemo(() => toCalendarEvents(items), [items]);
  const openEvent = useMemo<CalendarEvent | null>(
    () => calendarEvents.find((event) => event.id === openEventId) ?? null,
    [calendarEvents, openEventId],
  );
  const openItem = (item: CalendarItem) => {
    if (item.taskId) {
      openTask(item.taskId);
      return;
    }
    setOpenEventId(item.id);
  };

  const completeTask = (task: Task) => {
    const previous = task.completedAt ?? "";
    void updateTask
      .mutateAsync({ id: task.id, completedAt: new Date().toISOString() })
      .then(() => {
        showUndoToast(`Completed “${task.name}”`, () => {
          void updateTask.mutateAsync({ id: task.id, completedAt: previous });
        });
      });
  };

  const stopAndComplete = (task: Task) => {
    void stopFocus.mutateAsync(task.id).then(() => completeTask(task));
  };

  const mutating = stopFocus.isPending || updateTask.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">
          {data?.date
            ? new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : "Your day"}
          {typeof data?.inboxCount === "number" ? ` · ${data.inboxCount} in inbox` : ""}
        </p>
      </header>
      <div className="flex flex-1 flex-col space-y-6 overflow-y-auto p-6">
        {today.isError && data ? (
          <LoadErrorBanner
            what="today"
            error={today.error}
            onRetry={() => today.refetch()}
            retrying={today.isFetching}
          />
        ) : null}
        {today.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading today…</p>
        ) : !data ? (
          today.isError ? (
            <LoadError
              what="today"
              error={today.error}
              onRetry={() => today.refetch()}
              retrying={today.isFetching}
            />
          ) : (
            <EmptyState icon={Sun} title="Nothing to show" description="Today has no data yet." />
          )
        ) : (
          <>
            {data.focusing ? (
              <FocusingPanel
                task={data.focusing}
                busy={mutating}
                onOpen={() => openTask(data.focusing!.id)}
                onStop={() => void stopFocus.mutateAsync(data.focusing!.id)}
                onDone={() => stopAndComplete(data.focusing!)}
              />
            ) : null}

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Today focus
              </h2>
              {data.todayFocus.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Star up to 7 tasks from a task detail. This set is independent of deadlines.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.todayFocus.map((task) => (
                    <li key={task.id} className="flex items-center gap-2">
                      <div className="flex-1">
                        <TaskRow task={task} onOpen={() => openTask(task.id)} extra={task.priorityLevel ?? undefined} />
                      </div>
                      {!data.focusing || data.focusing.id !== task.id ? (
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/40"
                          onClick={() => void startFocus.mutateAsync(task.id)}
                        >
                          Start
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/40"
                        onClick={() => completeTask(task)}
                        aria-label={`Complete ${task.name}`}
                        title="Mark done"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void setFocus.mutateAsync({ taskId: task.id, date: null })}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Scheduled
              </h2>
              {scheduled.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on the calendar today.</p>
              ) : (
                <ul className="space-y-2">
                  {scheduled.map((item: CalendarItem) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-accent/40"
                      >
                        <span className="min-w-0 truncate">
                          {item.title}
                          {!item.taskId ? (
                            <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                              Event
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.allDay ? "All day" : `${formatTime(item.start)} – ${formatTime(item.end)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {reminders.length > 0 ? (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reminders
                </h2>
                <ul className="space-y-2">
                  {reminders.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-accent/40"
                      >
                        <span className="truncate">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(item.start)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.overdue.length > 0 ? (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Overdue
                </h2>
                <ul className="space-y-2">
                  {data.overdue.map((task) => (
                    <li key={task.id} className="flex items-center gap-2">
                      <div className="flex-1">
                        <TaskRow task={task} onOpen={() => openTask(task.id)} extra={task.deadline ?? undefined} />
                      </div>
                      <Link
                        href={`/calendar?taskId=${encodeURIComponent(task.id)}`}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/40"
                      >
                        Reschedule
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="rounded-xl border border-border p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                End of day
              </h2>
              <p className="text-sm text-muted-foreground">
                Completed {data.completedToday.length} · Unfinished {data.unfinished.length} · Tomorrow{" "}
                {data.tomorrowFocus.length}
              </p>
              {data.unfinished.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {data.unfinished.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3">
                      <button type="button" onClick={() => openTask(task.id)} className="min-w-0 truncate text-left">
                        {task.name}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          void setFocus.mutateAsync({
                            taskId: task.id,
                            date: addCalendarDays(data.date, 1),
                          });
                        }}
                      >
                        Move to tomorrow
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {(inbox.data?.length ?? 0) > 0 ? (
              <p className="text-sm text-muted-foreground">
                {inbox.data!.length} inbox item{inbox.data!.length === 1 ? "" : "s"} waiting.{" "}
                <Link href="/inbox" className="underline">
                  Review inbox
                </Link>
              </p>
            ) : null}
          </>
        )}
      </div>
      <EventDialog
        event={openEvent}
        onClose={() => setOpenEventId(null)}
        onOpenTask={(taskId) => {
          setOpenEventId(null);
          openTask(taskId);
        }}
      />
    </div>
  );
}
