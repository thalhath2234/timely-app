"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CornerDownLeft, Inbox, Target } from "lucide-react";
import {
  MATRIX_LABELS,
  completionStreak,
  completionsByDay,
  daysUntil,
  priorityMatrix,
  shortDay,
  timeProgress,
  weekStart,
  workdayWindow,
  type MatrixQuadrant,
} from "@timely/contract/dashboard";
import { addDaysToDate, todayInZone } from "@timely/contract/workStatus";
import type { CalendarItem, Task, TodayResponse, WorkingHours } from "@/app/_types/types";
import { useCaptureInbox } from "@/app/utils/hooks/tasks";
import { formatTime } from "@/app/utils/calendar";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import DatePicker from "@/app/_components/_ui/datePicker";
import { Meter, useElementSize } from "./charts";

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

export function TodayCard({
  today,
  loading,
  now,
  onOpenTask,
  onOpenItem,
}: {
  today: TodayResponse | undefined;
  loading: boolean;
  now: Date;
  onOpenTask: (id: string) => void;
  onOpenItem: (item: CalendarItem) => void;
}) {
  if (loading && !today) return <Muted text="Loading today…" />;
  if (!today) return <Muted text="Today isn't available right now." />;

  const doneIds = new Set(today.completedToday.map((task) => task.id));
  const planned = new Set<string>(doneIds);
  for (const item of today.items) {
    if ((item.kind === "task" || item.kind === "taskOccurrence") && item.taskId && !item.reminder) planned.add(item.taskId);
  }
  for (const task of today.todayFocus) planned.add(task.id);
  const doneCount = doneIds.size;
  const share = planned.size ? doneCount / planned.size : 0;
  const upNext = today.items
    .filter((item) => new Date(item.end).getTime() >= now.getTime() && !item.completedAt)
    .sort((a, b) => a.start.localeCompare(b.start));
  const focusing = today.focusing ?? today.pausedFocus;

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">
            <span className="text-base font-semibold tabular-nums text-foreground">{doneCount}</span> of {planned.size} done
          </span>
          {today.overdue.length > 0 ? (
            <Link href="/today" className="text-destructive hover:underline">
              {today.overdue.length} overdue
            </Link>
          ) : null}
        </div>
        <Meter value={share} color="var(--success)" />
      </div>

      {focusing ? (
        <button
          type="button"
          onClick={() => onOpenTask(focusing.id)}
          className="flex items-center gap-2 rounded-lg border border-border bg-accent/40 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
        >
          <span className={cn("size-2 shrink-0 rounded-full", today.focusing ? "animate-pulse bg-primary" : "bg-muted-foreground")} />
          <span className="min-w-0 flex-1 truncate text-foreground">{focusing.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{today.focusing ? "Focusing" : "Paused"}</span>
        </button>
      ) : null}

      <div className="min-h-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Up next</p>
        {upNext.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing else on the calendar today.</p>
        ) : (
          <ul className="flex h-full flex-col gap-0.5 overflow-y-auto pb-5">
            {upNext.map((item) => {
              const started = new Date(item.start).getTime() <= now.getTime();
              return (
                <li key={`${item.id}-${item.blockId ?? ""}-${item.start}`}>
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-accent/50"
                  >
                    <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {item.allDay ? "All day" : formatTime(new Date(item.start))}
                    </span>
                    <span
                      className="h-4 w-0.5 shrink-0 rounded-full"
                      style={{ background: item.color ?? (item.kind.startsWith("event") ? "var(--series-2)" : "var(--primary)") }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
                    {started ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-primary">Now</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quick capture                                                       */
/* ------------------------------------------------------------------ */

export function QuickCaptureCard({ inboxCount }: { inboxCount: number }) {
  const [text, setText] = useState("");
  const capture = useCaptureInbox();
  const submit = () => {
    const name = text.trim();
    if (!name || capture.isPending) return;
    capture.mutate(name, {
      onSuccess: () => {
        setText("");
        useToastStore.getState().show("Added to Inbox");
      },
      onError: (error) => useToastStore.getState().show(error instanceof Error ? error.message : "Could not add to Inbox"),
    });
  };
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 rounded-lg border border-border bg-input/30 px-2.5 py-1.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Capture a thought, task or idea…"
          aria-label="Capture to Inbox"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!text.trim() || capture.isPending}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label="Add to Inbox"
        >
          <CornerDownLeft className="size-3.5" />
        </button>
      </form>
      <Link href="/inbox" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <Inbox className="size-3.5" />
        {inboxCount === 0 ? "Inbox is empty" : `${inboxCount} waiting in Inbox`}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export function NotesCard({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [value, setValue] = useState(text);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);

  // Another device's edit shows up unless this one is mid-typing.
  useEffect(() => {
    if (!focused.current) setValue(text);
  }, [text]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <textarea
      value={value}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (value !== text) onChange(value);
      }}
      onChange={(event) => {
        const next = event.target.value.slice(0, 20_000);
        setValue(next);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onChange(next), 500);
      }}
      placeholder="Jot something down. It saves as you type."
      aria-label="Scratchpad"
      className="h-full w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Streak heatmap                                                      */
/* ------------------------------------------------------------------ */

function heatLevel(count: number, max: number) {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const share = count / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

export function StreakCard({ tasks, timeZone }: { tasks: Task[]; timeZone?: string }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const today = todayInZone(timeZone);
  const counts = useMemo(() => completionsByDay(tasks, timeZone), [tasks, timeZone]);
  const streak = useMemo(() => completionStreak(counts, today), [counts, today]);
  const [hover, setHover] = useState<{ day: string; count: number } | null>(null);

  const gap = 3;
  const cell = Math.max(8, Math.min(16, Math.floor((size.height - 18 - gap * 6) / 7)));
  const weeks = Math.max(4, Math.min(53, Math.floor((size.width + gap) / (cell + gap))));
  const firstWeek = addDaysToDate(weekStart(today), -7 * (weeks - 1));
  const columns = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDaysToDate(firstWeek, week * 7 + day)),
  );
  const visible = columns.flat().filter((day) => day <= today);
  const max = Math.max(1, ...visible.map((day) => counts.get(day) ?? 0));
  const totalInView = visible.reduce((sum, day) => sum + (counts.get(day) ?? 0), 0);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-baseline gap-4 text-xs text-muted-foreground">
        <span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{streak.current}</span> day streak
        </span>
        <span>
          Best <span className="font-medium tabular-nums text-foreground">{streak.best}</span>
        </span>
        <span className="ml-auto truncate">
          {hover ? `${shortDay(hover.day)}: ${hover.count} done` : `${totalInView} done in ${weeks} weeks`}
        </span>
      </div>
      <div ref={ref} className="min-h-0 flex-1" onPointerLeave={() => setHover(null)}>
        <div className="flex" style={{ gap }} role="img" aria-label={`Tasks completed per day over ${weeks} weeks`}>
          {columns.map((days) => (
            <div key={days[0]} className="flex flex-col" style={{ gap }}>
              {days.map((day) => {
                const count = counts.get(day) ?? 0;
                const future = day > today;
                return (
                  <span
                    key={day}
                    onPointerEnter={() => !future && setHover({ day, count })}
                    className={cn("rounded-[3px]", day === today && "ring-1 ring-foreground/40")}
                    style={{
                      width: cell,
                      height: cell,
                      background: future ? "transparent" : `var(--heat-${heatLevel(count, max)})`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          Less
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="size-2.5 rounded-[2px]" style={{ background: `var(--heat-${level})` }} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Day and week progress                                               */
/* ------------------------------------------------------------------ */

export function DayProgressCard({ now, workingHours, timeZone }: { now: Date; workingHours?: WorkingHours | null; timeZone?: string }) {
  const workday = workdayWindow(workingHours, now);
  const progress = timeProgress(now, workday, timeZone);
  const rows = [
    { label: workday ? `Workday ${workday.start}–${workday.end}` : "Day", value: progress.day, hint: workday ? progress.dayLabel : null },
    { label: "Week", value: progress.week },
    { label: "Month", value: progress.month },
    { label: "Year", value: progress.year },
  ];
  return (
    <ul className="flex h-full flex-col justify-center gap-3">
      {rows.map((row, index) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="text-foreground">{row.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {row.hint ? `${row.hint} · ` : ""}
              {Math.floor(row.value * 100)}%
            </span>
          </div>
          <Meter value={row.value} color={index} />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Priority matrix                                                     */
/* ------------------------------------------------------------------ */

const QUADRANT_TINT: Record<MatrixQuadrant, string> = {
  do: "var(--series-8)",
  schedule: "var(--series-1)",
  quick: "var(--series-4)",
  later: "var(--series-other)",
};

export function MatrixCard({
  tasks,
  timeZone,
  urgentDays,
  onOpenTask,
}: {
  tasks: Task[];
  timeZone?: string;
  urgentDays: number;
  onOpenTask: (id: string) => void;
}) {
  const today = todayInZone(timeZone);
  const matrix = useMemo(() => priorityMatrix(tasks, today, urgentDays), [tasks, today, urgentDays]);
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-2">
      {(["do", "schedule", "quick", "later"] as const).map((quadrant) => (
        <section key={quadrant} className="flex min-h-0 flex-col rounded-lg border border-border bg-background/40 p-2">
          <header className="mb-1 flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: QUADRANT_TINT[quadrant] }} />
            <h3 className="text-xs font-semibold text-foreground">{MATRIX_LABELS[quadrant].title}</h3>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{matrix[quadrant].length}</span>
          </header>
          <p className="mb-1 truncate text-[10px] text-muted-foreground">{MATRIX_LABELS[quadrant].hint}</p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {matrix[quadrant].map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent/60"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{task.name}</span>
                  {task.deadline ? <span className="shrink-0 tabular-nums text-muted-foreground">{shortDay(task.deadline.slice(0, 10))}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Countdown                                                           */
/* ------------------------------------------------------------------ */

export function CountdownCard({
  label,
  date,
  timeZone,
  onChange,
}: {
  label: string;
  date: string;
  timeZone?: string;
  onChange: (next: { label?: string; date?: string }) => void;
}) {
  const [editing, setEditing] = useState(!date);
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftDate, setDraftDate] = useState(date);
  const today = todayInZone(timeZone);
  const days = date ? daysUntil(date, today) : null;

  if (editing || days === null) {
    return (
      <form
        className="flex h-full flex-col justify-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draftDate) return;
          onChange({ label: draftLabel.trim(), date: draftDate });
          setEditing(false);
        }}
      >
        <input
          value={draftLabel}
          onChange={(event) => setDraftLabel(event.target.value.slice(0, 80))}
          placeholder="What are you counting down to?"
          aria-label="Countdown name"
          className="rounded-md border border-border bg-input/30 px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
        />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <DatePicker
              value={draftDate}
              onChange={setDraftDate}
              clearable={false}
              placeholder="Pick a date"
              aria-label="Date"
              className="rounded-md px-2 py-1"
            />
          </div>
          <button type="submit" disabled={!draftDate} className="rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            Save
          </button>
        </div>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraftLabel(label);
        setDraftDate(date);
        setEditing(true);
      }}
      title="Change the date"
      className="flex h-full w-full flex-col items-start justify-end text-left"
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold leading-none tabular-nums text-foreground">{Math.abs(days)}</span>
        <span className="text-sm text-muted-foreground">{Math.abs(days) === 1 ? "day" : "days"}</span>
      </span>
      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {days >= 0 ? <Target className="size-3.5" /> : <CalendarDays className="size-3.5" />}
        {days === 0 ? "Today" : days > 0 ? "until" : "since"} {label || shortDay(date)} · {shortDay(date)}
      </span>
    </button>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</p>;
}
