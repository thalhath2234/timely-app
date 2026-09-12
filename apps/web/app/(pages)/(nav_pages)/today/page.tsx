"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sun } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import EntityDetailPanel from "@/app/_components/_ui/tasks/entityDetailPanel";
import { addCalendarDays } from "@/app/utils/calendar";
import { useToday } from "@/app/utils/hooks/calendar";
import { useInboxTasks, useSetTodayFocus, useStartFocus, useStopFocus } from "@/app/utils/hooks/tasks";
import type { CalendarItem, Task } from "@/app/_types/types";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

export default function TodayPage() {
  const today = useToday();
  const inbox = useInboxTasks();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const [openId, setOpenId] = useState<string | null>(null);
  const data = today.data;
  const items = data?.items ?? [];
  const scheduled = useMemo(
    () => items.filter((item) => !item.reminder),
    [items],
  );
  const reminders = useMemo(
    () => items.filter((item) => item.reminder),
    [items],
  );

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
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {today.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading today…</p>
        ) : !data ? (
          <EmptyState icon={Sun} title="Could not load today" description="Try again in a moment." />
        ) : (
          <>
            {data.focusing ? (
              <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focusing</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <button type="button" className="text-left font-medium" onClick={() => setOpenId(data.focusing!.id)}>
                    {data.focusing.name}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                    onClick={() => void stopFocus.mutateAsync(data.focusing!.id)}
                  >
                    Stop
                  </button>
                </div>
                {(data.focusing.actualMinutes ?? 0) > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{data.focusing.actualMinutes}m focused so far</p>
                ) : null}
              </section>
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
                        <TaskRow task={task} onOpen={() => setOpenId(task.id)} extra={task.priorityLevel ?? undefined} />
                      </div>
                      {!data.focusing || data.focusing.id !== task.id ? (
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs"
                          onClick={() => void startFocus.mutateAsync(task.id)}
                        >
                          Start
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="text-xs text-muted-foreground"
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
                        onClick={() => item.taskId && setOpenId(item.taskId)}
                        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-accent/40"
                      >
                        <span className="truncate">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.allDay ? "All day" : formatTime(item.start)}
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
                    <li key={item.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                      <span>{item.title}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(item.start)}</span>
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
                    <li key={task.id}>
                      <TaskRow task={task} onOpen={() => setOpenId(task.id)} extra={task.deadline ?? undefined} />
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
                    <li key={task.id} className="flex items-center justify-between">
                      <button type="button" onClick={() => setOpenId(task.id)} className="truncate text-left">
                        {task.name}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground"
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
      {openId ? (
        <EntityDetailPanel kind="task" id={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
