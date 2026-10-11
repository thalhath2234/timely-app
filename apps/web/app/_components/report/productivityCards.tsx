"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Flame,
  Inbox,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SkipForward,
  Timer as TimerIcon,
  X,
} from "lucide-react";
import {
  HABIT_LIMIT,
  CLOCK_MAX_LAPS,
  clockElapsed,
  clockEndsAt,
  clockRemaining,
  clockState,
  completionsByDay,
  docPlainText,
  focusSummary,
  formatMinutes,
  formatStopwatch,
  goalSettings,
  habitList,
  habitLog,
  habitStreak,
  journalPrompt,
  newCardId,
  nextUp,
  setReviewNote,
  shortDay,
  toggleHabit,
  topThreeLeftover,
  topThreePicks,
  topThreeSuggestions,
  upsertJournalSection,
  weekStart,
  weeklyReview,
  workdayWindow,
  type ClockState,
  type GoalMetric,
  type SeriesPoint,
} from "@timely/contract/dashboard";
import { addDaysToDate, daysBetween, todayInZone } from "@timely/contract/workStatus";
import type { CalendarItem, Task, WorkingHours } from "@/app/_types/types";
import { useFocusSessions, useUpdateTask } from "@/app/utils/hooks/tasks";
import { openDailyDoc, updateDoc } from "@/app/utils/api/docs";
import { docKey, docsKey } from "@/app/utils/hooks/docs";
import { fileHref } from "@/app/utils/fileRoutes";
import { formatTime } from "@/app/utils/calendar";
import { chime, notify } from "@/app/utils/chime";
import { useToastStore } from "@/app/_store/toastStore";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { usePomodoroStore } from "@/app/_store/pomodoroStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { cn } from "@/app/utils/cn";
import { ColumnChart } from "./charts";

type Settings = Record<string, unknown>;
type OnSettings = (next: Settings) => void;

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function toast(message: string) {
  useToastStore.getState().show(message);
}

/** A clock that ticks only while `running`, for live counters. */
function useTicker(running: boolean, intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs]);
  return now;
}

/** Saves text a moment after typing stops, and on blur; another device's edit shows up when not typing. */
function useDraft(saved: string, onSave: (text: string) => void, limit = 4000) {
  const [value, setValue] = useState(saved);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
    if (!focused.current) setValue(saved);
  }, [saved]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return {
    value,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (value !== savedRef.current) onSave(value);
    },
    onChange: (next: string) => {
      const text = next.slice(0, limit);
      setValue(text);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => onSave(text), 600);
    },
  };
}

function useCompleteTask() {
  const updateTask = useUpdateTask();
  return (task: Task) => {
    const completedAt = task.completedAt ? "" : new Date().toISOString();
    updateTask.mutate(
      { id: task.id, completedAt },
      { onError: (error) => toast(error instanceof Error ? error.message : "Could not update the task") },
    );
  };
}

function RoundCheck({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-success bg-success text-background" : "border-muted-foreground/50 hover:border-foreground",
      )}
    >
      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">{text}</p>;
}

/* ------------------------------------------------------------------ */
/* Top 3 for today                                                     */
/* ------------------------------------------------------------------ */

export function TopThreeCard({
  settings,
  tasks,
  timeZone,
  onSettings,
  onOpenTask,
}: {
  settings: Settings;
  tasks: Task[];
  timeZone?: string;
  onSettings: OnSettings;
  onOpenTask: (id: string) => void;
}) {
  const today = todayInZone(timeZone);
  const picks = topThreePicks(settings, today);
  const leftover = picks.length === 0 ? topThreeLeftover(settings, today, tasks) : [];
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const [picking, setPicking] = useState(false);
  const complete = useCompleteTask();
  const chosen = picks.map((id) => byId.get(id)).filter((task): task is Task => Boolean(task));
  const allDone = chosen.length === 3 && chosen.every((task) => task.completedAt);

  const save = (taskIds: string[]) => onSettings({ day: today, taskIds });

  return (
    <div className="relative flex h-full flex-col gap-1.5">
      <ol className="flex flex-col gap-1">
        {[0, 1, 2].map((slot) => {
          const task = chosen[slot];
          if (!task) {
            return (
              <li key={`empty-${slot}`}>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                >
                  <span className="flex size-[18px] items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-[10px] tabular-nums">
                    {slot + 1}
                  </span>
                  Pick a task
                </button>
              </li>
            );
          }
          const done = Boolean(task.completedAt);
          return (
            <li key={task.id} className="group/pick flex items-center gap-2.5 rounded-lg border border-border bg-background/40 px-2.5 py-2">
              <RoundCheck checked={done} onToggle={() => complete(task)} label={done ? `Reopen ${task.name}` : `Complete ${task.name}`} />
              <button
                type="button"
                onClick={() => onOpenTask(task.id)}
                className={cn("min-w-0 flex-1 truncate text-left text-sm", done ? "text-muted-foreground line-through" : "text-foreground hover:underline")}
              >
                {task.name}
              </button>
              <button
                type="button"
                onClick={() => save(picks.filter((id) => id !== task.id))}
                aria-label={`Remove ${task.name} from today's three`}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/pick:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
      {allDone ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <Check className="size-3.5" /> All three done. Good day.
        </p>
      ) : leftover.length > 0 ? (
        <button type="button" onClick={() => save(leftover)} className="self-start text-xs text-primary hover:underline">
          Carry over {leftover.length} unfinished from {shortDay(String(settings.day))}
        </button>
      ) : null}
      {picking ? (
        <TaskPicker
          tasks={topThreeSuggestions(tasks, today, picks)}
          today={today}
          onPick={(id) => {
            save([...picks, id].slice(0, 3));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

function TaskPicker({ tasks, today, onPick, onClose }: { tasks: Task[]; today: string; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);
  const needle = query.trim().toLowerCase();
  const shown = (needle ? tasks.filter((task) => task.name.toLowerCase().includes(needle)) : tasks).slice(0, 30);
  return (
    <div
      ref={ref}
      className="absolute inset-x-0 top-0 z-10 flex max-h-full flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a task"
          aria-label="Find a task"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.length === 0 ? <li className="px-2 py-3 text-center text-xs text-muted-foreground">No open tasks match.</li> : null}
        {shown.map((task) => {
          const deadline = task.deadline?.slice(0, 10);
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onPick(task.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{task.name}</span>
                {deadline ? (
                  <span className={cn("shrink-0 text-xs tabular-nums", deadline < today ? "text-destructive" : "text-muted-foreground")}>
                    {deadline === today ? "Today" : shortDay(deadline)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Focus time                                                          */
/* ------------------------------------------------------------------ */

/** This week's focus sessions, from the Monday before (with a day of slack for time zones) to tomorrow. */
function useWeekFocus(tasks: Task[], now: Date, timeZone?: string) {
  const today = todayInZone(timeZone, now);
  const range = useMemo(() => {
    const monday = weekStart(today);
    return { from: new Date(`${addDaysToDate(monday, -1)}T00:00:00`), to: new Date(`${addDaysToDate(today, 2)}T00:00:00`) };
  }, [today]);
  const sessions = useFocusSessions(range.from, range.to);
  const summary = useMemo(() => focusSummary(sessions.data ?? [], tasks, now, timeZone), [sessions.data, tasks, now, timeZone]);
  return { summary, loading: sessions.isLoading, error: sessions.isError };
}

export function FocusTimeCard({ tasks, now, timeZone }: { tasks: Task[]; now: Date; timeZone?: string }) {
  const { summary, loading, error } = useWeekFocus(tasks, now, timeZone);
  const today = todayInZone(timeZone, now);
  const pomodoros = usePomodoroStore((state) => Object.values(state.timers).reduce((sum, timer) => sum + (timer.history?.[today] ?? 0), 0));
  const points: SeriesPoint[] = summary.days.map((entry, index) => ({
    key: entry.day,
    label: WEEKDAY_LETTERS[index],
    value: Math.round((entry.minutes / 60) * 10) / 10,
    detail: shortDay(entry.day),
  }));

  if (loading && summary.week === 0) return <Muted text="Loading focus time…" />;
  if (error && summary.week === 0) return <Muted text="Focus time isn't available right now." />;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-end gap-5">
        <div>
          <p className="text-3xl font-semibold leading-none tabular-nums text-foreground">{formatMinutes(summary.today)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            today{pomodoros > 0 ? ` · ${pomodoros} ${pomodoros === 1 ? "pomodoro" : "pomodoros"}` : ""}
          </p>
        </div>
        <div>
          <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{formatMinutes(summary.week)}</p>
          <p className="mt-1 text-xs text-muted-foreground">this week</p>
        </div>
      </div>
      <div className="min-h-[72px] flex-1">
        <ColumnChart points={points} unit="hours" color={1} />
      </div>
      {summary.tasks.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {summary.tasks.slice(0, 3).map((entry) => (
            <li key={entry.id ?? entry.name} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">{entry.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatMinutes(entry.minutes)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Start focus on a task, or link one to a pomodoro, and the time shows up here.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Next up                                                             */
/* ------------------------------------------------------------------ */

function untilText(start: string, now: Date) {
  const minutes = Math.max(0, Math.ceil((new Date(start).getTime() - now.getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60 * 24) return `in ${formatMinutes(minutes)}`;
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function timeRange(item: CalendarItem) {
  return `${formatTime(new Date(item.start))}–${formatTime(new Date(item.end))}`;
}

export function NextUpCard({
  events,
  loading,
  now,
  workingHours,
  timeZone,
  onOpenEvent,
}: {
  events: CalendarItem[];
  loading: boolean;
  now: Date;
  workingHours?: WorkingHours | null;
  timeZone?: string;
  onOpenEvent: (start: string) => void;
}) {
  const result = useMemo(() => nextUp(events, now, workdayWindow(workingHours, now), timeZone), [events, now, workingHours, timeZone]);
  if (loading && events.length === 0) return <Muted text="Loading your calendar…" />;
  const { current, next, later, freeMinutes, workMinutesLeft } = result;
  const nextIsToday = next ? todayInZone(timeZone, new Date(next.start)) === todayInZone(timeZone, now) : false;

  return (
    <div className="flex h-full flex-col gap-2">
      {current ? (
        <button type="button" onClick={() => onOpenEvent(current.start)} className="flex items-center gap-2 text-left text-xs">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            Now: {current.title} <span className="text-muted-foreground">until {formatTime(new Date(current.end))}</span>
          </span>
        </button>
      ) : null}
      {next ? (
        <button type="button" onClick={() => onOpenEvent(next.start)} className="text-left">
          <p className="text-2xl font-semibold leading-tight text-foreground">{untilText(next.start, now)}</p>
          <p className="mt-0.5 truncate text-sm text-foreground">{next.title}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {nextIsToday ? timeRange(next) : `${shortDay(todayInZone(timeZone, new Date(next.start)))} · ${timeRange(next)}`}
          </p>
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing coming up on the calendar.</p>
      )}
      {later.length > 0 ? (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {later.map((item) => (
            <li key={`${item.id}-${item.start}`}>
              <button
                type="button"
                onClick={() => onOpenEvent(item.start)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
              >
                <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(new Date(item.start))}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}
      <p className="border-t border-border pt-1.5 text-xs text-muted-foreground">
        {freeMinutes === null || workMinutesLeft === null ? (
          <Link href="/settings" className="hover:text-foreground hover:underline">
            Set working hours to see free time
          </Link>
        ) : workMinutesLeft === 0 ? (
          "Working hours are over for today"
        ) : (
          <>
            <span className="font-medium tabular-nums text-foreground">{formatMinutes(freeMinutes)}</span> free of {formatMinutes(workMinutesLeft)} left today
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Habits                                                              */
/* ------------------------------------------------------------------ */

export function HabitsCard({ settings, timeZone, onSettings }: { settings: Settings; timeZone?: string; onSettings: OnSettings }) {
  const today = todayInZone(timeZone);
  const habits = habitList(settings);
  const log = habitLog(settings);
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDate(today, index - 6));
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = () => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed || habits.length >= HABIT_LIMIT) return;
    onSettings({ habits: [...habits, { id: newCardId(), name: trimmed }] });
    setName("");
  };
  const rename = (id: string) => {
    const trimmed = editName.trim().slice(0, 60);
    setEditing(null);
    if (trimmed) onSettings({ habits: habits.map((habit) => (habit.id === id ? { ...habit, name: trimmed } : habit)) });
  };
  const remove = (id: string, label: string) =>
    requestConfirm({
      title: `Delete "${label}"?`,
      description: "Its ticks and streak go with it.",
      confirmLabel: "Delete",
      onConfirm: () => {
        const nextLog: Record<string, string[]> = {};
        for (const [day, ids] of Object.entries(log)) {
          const kept = ids.filter((entry) => entry !== id);
          if (kept.length) nextLog[day] = kept;
        }
        onSettings({ habits: habits.filter((habit) => habit.id !== id), log: nextLog });
      },
    });

  return (
    <div className="flex h-full flex-col gap-2">
      {habits.length > 0 ? (
        <div className="flex items-center gap-2 pr-1 text-[10px] text-muted-foreground">
          <span className="flex-1" />
          {days.map((day) => (
            <span key={day} className={cn("w-5 text-center", day === today && "font-semibold text-foreground")}>
              {WEEKDAY_LETTERS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]}
            </span>
          ))}
          <span className="w-8" />
        </div>
      ) : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {habits.length === 0 ? (
          <li className="py-3 text-center text-sm text-muted-foreground">Add a habit you want to keep, like reading or a walk.</li>
        ) : null}
        {habits.map((habit) => {
          const streak = habitStreak(log, habit.id, today);
          return (
            <li key={habit.id} className="group/habit flex items-center gap-2 pr-1">
              {editing === habit.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={() => rename(habit.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") rename(habit.id);
                    if (event.key === "Escape") setEditing(null);
                  }}
                  aria-label="Habit name"
                  className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm text-foreground outline-none"
                />
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <button
                    type="button"
                    onDoubleClick={() => {
                      setEditing(habit.id);
                      setEditName(habit.name);
                    }}
                    title="Double-click to rename"
                    className="min-w-0 truncate text-left text-sm text-foreground"
                  >
                    {habit.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(habit.id, habit.name)}
                    aria-label={`Delete ${habit.name}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:opacity-100 group-hover/habit:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )}
              {days.map((day) => {
                const done = (log[day] ?? []).includes(habit.id);
                return (
                  <button
                    key={day}
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={`${habit.name} on ${shortDay(day)}`}
                    onClick={() => onSettings({ log: toggleHabit(log, habit.id, day, today) })}
                    className={cn(
                      "flex size-5 items-center justify-center rounded-md border transition-colors",
                      done ? "border-transparent bg-success text-background" : "border-border hover:border-ring",
                      day === today && !done && "border-foreground/40",
                    )}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : null}
                  </button>
                );
              })}
              <span
                className={cn("flex w-8 items-center justify-end gap-0.5 text-xs tabular-nums", streak > 0 ? "text-foreground" : "text-muted-foreground/60")}
                title={`${streak} day streak`}
              >
                <Flame className={cn("size-3", streak > 0 ? "text-[var(--series-2)]" : "")} />
                {streak}
              </span>
            </li>
          );
        })}
      </ul>
      {habits.length < HABIT_LIMIT ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-input/30 px-2.5 py-1 focus-within:border-ring"
        >
          <Plus className="size-3.5 text-muted-foreground" />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Add a habit"
            aria-label="New habit"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Daily goal                                                          */
/* ------------------------------------------------------------------ */

export function GoalCard({
  settings,
  tasks,
  now,
  timeZone,
  onSettings,
}: {
  settings: Settings;
  tasks: Task[];
  now: Date;
  timeZone?: string;
  onSettings: OnSettings;
}) {
  const goal = goalSettings(settings);
  const [editing, setEditing] = useState(false);
  const today = todayInZone(timeZone, now);
  const doneToday = useMemo(() => completionsByDay(tasks, timeZone).get(today) ?? 0, [tasks, timeZone, today]);
  const { summary } = useWeekFocus(tasks, now, timeZone);
  const value = goal.metric === "tasks" ? doneToday : Math.round((summary.today / 60) * 10) / 10;
  const share = Math.min(1, value / goal.target);
  const reached = value >= goal.target;

  const size = 112;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = reached ? "var(--success)" : "var(--primary)";

  const setTarget = (target: number) => onSettings({ metric: goal.metric, target });
  const setMetric = (metric: GoalMetric) => onSettings({ metric, target: metric === "tasks" ? 5 : 4 });
  const step = goal.metric === "tasks" ? 1 : 0.5;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => setEditing((open) => !open)}
        aria-label="Goal settings"
        aria-expanded={editing}
        className="absolute right-0 top-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Settings2 className="size-3.5" />
      </button>
      {editing ? (
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex rounded-lg border border-border p-0.5 text-xs" role="radiogroup" aria-label="Goal">
            {(["tasks", "focus"] as const).map((metric) => (
              <button
                key={metric}
                type="button"
                role="radio"
                aria-checked={goal.metric === metric}
                onClick={() => metric !== goal.metric && setMetric(metric)}
                className={cn("rounded-md px-2.5 py-1", goal.metric === metric ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {metric === "tasks" ? "Tasks done" : "Focus hours"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <StepButton label="Lower the goal" onClick={() => setTarget(goal.target - step)} icon={Minus} />
            <span className="w-14 text-center text-2xl font-semibold tabular-nums text-foreground">{goal.target}</span>
            <StepButton label="Raise the goal" onClick={() => setTarget(goal.target + step)} icon={Plus} />
          </div>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-primary hover:underline">
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${value} of ${goal.target}`}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`color-mix(in oklch, ${color} 18%, transparent)`} strokeWidth={stroke} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - share)}
                className="transition-[stroke-dashoffset] duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tabular-nums text-foreground">
                {value}
                <span className="text-sm font-normal text-muted-foreground"> / {goal.target}</span>
              </span>
            </div>
          </div>
          <p className={cn("text-xs", reached ? "font-medium text-success" : "text-muted-foreground")}>
            {reached ? "Goal reached" : goal.metric === "tasks" ? "tasks done today" : "hours focused today"}
          </p>
        </>
      )}
    </div>
  );
}

function StepButton({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: typeof Plus }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Weekly review                                                       */
/* ------------------------------------------------------------------ */

type ReviewTab = "done" | "slipped" | "carried";

const REVIEW_TABS: { key: ReviewTab; label: string; tone: string }[] = [
  { key: "done", label: "Done", tone: "text-success" },
  { key: "slipped", label: "Slipped", tone: "text-destructive" },
  { key: "carried", label: "Carried over", tone: "text-[var(--series-2)]" },
];

export function WeeklyReviewCard({
  settings,
  tasks,
  timeZone,
  onSettings,
  onOpenTask,
}: {
  settings: Settings;
  tasks: Task[];
  timeZone?: string;
  onSettings: OnSettings;
  onOpenTask: (id: string) => void;
}) {
  const today = todayInZone(timeZone);
  const [weeksBack, setWeeksBack] = useState(0);
  const [tab, setTab] = useState<ReviewTab>("done");
  const review = useMemo(() => weeklyReview(tasks, today, weeksBack, timeZone), [tasks, today, weeksBack, timeZone]);
  const notes = (settings.notes && typeof settings.notes === "object" ? settings.notes : {}) as Record<string, unknown>;
  const savedNote = typeof notes[review.from] === "string" ? (notes[review.from] as string) : "";
  const draft = useDraft(savedNote, (text) => onSettings({ notes: setReviewNote(notes, review.from, text) }));
  const list = review[tab];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setWeeksBack((value) => Math.min(4, value + 1))}
          disabled={weeksBack >= 4}
          aria-label="Previous week"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="font-medium text-foreground">
          {weeksBack === 0 ? "This week" : weeksBack === 1 ? "Last week" : `${shortDay(review.from)} – ${shortDay(review.to)}`}
        </span>
        <button
          type="button"
          onClick={() => setWeeksBack((value) => Math.max(0, value - 1))}
          disabled={weeksBack === 0}
          aria-label="Next week"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="ml-auto text-muted-foreground">
          {shortDay(review.from)} – {shortDay(review.to)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="tablist">
        {REVIEW_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-left transition-colors",
              tab === entry.key ? "border-ring bg-accent/50" : "border-border hover:bg-accent/30",
            )}
          >
            <span className={cn("block text-xl font-semibold leading-tight tabular-nums", entry.tone)}>{review[entry.key].length}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{entry.label}</span>
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <li className="py-2 text-center text-xs text-muted-foreground">
            {tab === "done" ? "Nothing finished yet." : tab === "slipped" ? "Nothing slipped. Nice." : "Nothing carried over."}
          </li>
        ) : null}
        {list.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{task.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {tab === "done" && task.completedAt
                  ? shortDay(todayInZone(timeZone, new Date(task.completedAt)))
                  : task.deadline
                    ? shortDay(task.deadline.slice(0, 10))
                    : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <textarea
        value={draft.value}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onChange={(event) => draft.onChange(event.target.value)}
        placeholder="What went well? What will you change next week?"
        aria-label="Notes for this week"
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inbox zero                                                          */
/* ------------------------------------------------------------------ */

/** Tasks carry a day, not a time, in createdAt. */
function ageText(createdAt: string, today: string) {
  const days = Math.max(0, daysBetween(createdAt.slice(0, 10), today));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function InboxZeroCard({ inbox, loading, now, timeZone }: { inbox: Task[]; loading: boolean; now: Date; timeZone?: string }) {
  const open = useMemo(
    () => inbox.filter((item) => !item.completedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [inbox],
  );
  const [skipped, setSkipped] = useState<string[]>([]);
  const complete = useCompleteTask();
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);

  if (loading && inbox.length === 0) return <Muted text="Loading Inbox…" />;
  if (open.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <p className="text-sm font-medium text-foreground">Inbox zero</p>
        <p className="text-xs text-muted-foreground">Nothing waiting to be sorted.</p>
      </div>
    );
  }
  const queue = [...open.filter((item) => !skipped.includes(item.id)), ...open.filter((item) => skipped.includes(item.id))];
  const next = queue[0];
  const review = () => {
    setCreateTaskDraft({ name: next.name, inboxId: next.id });
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <Link href="/inbox" className="flex items-baseline gap-1.5 hover:underline">
        <span className="text-3xl font-semibold leading-none tabular-nums text-foreground">{open.length}</span>
        <span className="text-sm text-muted-foreground">in Inbox</span>
      </Link>
      <div className="min-w-0 rounded-lg border border-border bg-background/40 px-2.5 py-2">
        <p className="truncate text-sm text-foreground">{next.name}</p>
        <p className="text-[11px] text-muted-foreground">Oldest · captured {ageText(next.createdAt, todayInZone(timeZone, now))}</p>
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        <button type="button" onClick={review} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          Review
        </button>
        <button
          type="button"
          onClick={() => complete(next)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
        >
          <Check className="size-3.5" /> Done
        </button>
        {open.length > 1 ? (
          <button
            type="button"
            onClick={() => setSkipped((ids) => [...ids.filter((id) => id !== next.id), next.id])}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <SkipForward className="size-3.5" /> Skip
          </button>
        ) : null}
        <Link href="/inbox" className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Open Inbox">
          <Inbox className="size-4" />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stopwatch and timer                                                 */
/* ------------------------------------------------------------------ */

/** Read the clock inside click handlers; keeps Date.now out of the render body. */
const clockNow = () => Date.now();

export function ClockCard({ title, settings, onSettings }: { title: string; settings: Settings; onSettings: OnSettings }) {
  const state = clockState(settings);
  const running = state.startedAt !== null;
  const now = useTicker(running, state.mode === "stopwatch" ? 100 : 250);
  const write = (next: Partial<ClockState>) => onSettings({ ...state, ...next });
  const elapsed = clockElapsed(state, now);
  const remaining = clockRemaining(state, now);

  // A timer that runs out while this card is on screen rings once and stops.
  const endsAt = clockEndsAt(state);
  const latest = useRef({ state, onSettings, title });
  useEffect(() => {
    latest.current = { state, onSettings, title };
  });
  useEffect(() => {
    if (endsAt === null) return;
    const finish = () => {
      const { state: current, onSettings: save, title: name } = latest.current;
      save({ ...current, startedAt: null, elapsed: current.minutes * 60_000, done: true });
      chime();
      notify("Timer done", name);
    };
    const wait = endsAt - Date.now();
    if (wait <= 0) {
      finish();
      return;
    }
    const id = window.setTimeout(finish, wait);
    return () => window.clearTimeout(id);
  }, [endsAt]);

  const start = () => write({ startedAt: clockNow(), done: false, ...(state.mode === "timer" && state.done ? { elapsed: 0 } : {}) });
  const pause = () => write({ elapsed: clockElapsed(state, clockNow()), startedAt: null });
  const reset = () => write({ startedAt: null, elapsed: 0, laps: [], done: false });
  const lap = () => write({ laps: [...state.laps, clockElapsed(state, clockNow())].slice(-CLOCK_MAX_LAPS) });
  const setMode = (mode: ClockState["mode"]) => mode !== state.mode && write({ mode, startedAt: null, elapsed: 0, laps: [], done: false });
  const setMinutes = (minutes: number) => write({ minutes: Math.min(600, Math.max(1, minutes)), elapsed: 0, done: false });
  const idle = !running && elapsed === 0;

  return (
    <div className="flex h-full flex-col items-center gap-2">
      <div className="flex rounded-lg border border-border p-0.5 text-xs" role="radiogroup" aria-label="Mode">
        {(["stopwatch", "timer"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.mode === mode}
            onClick={() => setMode(mode)}
            className={cn("rounded-md px-2.5 py-0.5", state.mode === mode ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {mode === "stopwatch" ? "Stopwatch" : "Timer"}
          </button>
        ))}
      </div>
      <div className="flex flex-1 items-center gap-2">
        {state.mode === "timer" && !running ? (
          <StepButton label="Take off a minute" onClick={() => setMinutes(Math.round(remaining / 60_000) - 1)} icon={Minus} />
        ) : null}
        <span
          className={cn(
            "font-semibold tabular-nums text-foreground",
            state.mode === "stopwatch" ? "text-3xl" : "text-4xl",
            state.done && "text-success",
          )}
          aria-live="off"
        >
          {state.mode === "stopwatch" ? formatStopwatch(elapsed, true) : state.done ? "Time's up" : formatStopwatch(remaining)}
        </span>
        {state.mode === "timer" && !running ? (
          <StepButton label="Add a minute" onClick={() => setMinutes(Math.round(remaining / 60_000) + 1)} icon={Plus} />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={idle && !state.done}
          aria-label="Reset"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={running ? pause : start}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          {running ? "Pause" : elapsed > 0 && !state.done ? "Resume" : "Start"}
        </button>
        {state.mode === "stopwatch" ? (
          <button
            type="button"
            onClick={lap}
            disabled={!running}
            aria-label="Lap"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <Flag className="size-4" />
          </button>
        ) : (
          <span className="flex size-8 items-center justify-center text-muted-foreground" title={`${state.minutes} minute timer`}>
            <TimerIcon className="size-4" />
          </span>
        )}
      </div>
      {state.mode === "stopwatch" && state.laps.length > 0 ? (
        <ol className="max-h-20 w-full overflow-y-auto border-t border-border pt-1 text-xs tabular-nums">
          {state.laps
            .map((at, index) => ({ at, index, split: at - (state.laps[index - 1] ?? 0) }))
            .reverse()
            .map((entry) => (
              <li key={entry.index} className="flex justify-between px-1 text-muted-foreground">
                <span>Lap {entry.index + 1}</span>
                <span className="text-foreground">{formatStopwatch(entry.split, true)}</span>
                <span>{formatStopwatch(entry.at, true)}</span>
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Daily journal                                                       */
/* ------------------------------------------------------------------ */

export function JournalCard({ settings, timeZone, onSettings }: { settings: Settings; timeZone?: string; onSettings: OnSettings }) {
  const today = todayInZone(timeZone);
  const prompt = journalPrompt(today);
  const isToday = settings.day === today;
  const savedText = isToday && typeof settings.text === "string" ? settings.text : "";
  const savedDocId = isToday && typeof settings.savedDocId === "string" ? settings.savedDocId : "";
  const savedToDoc = isToday && typeof settings.savedText === "string" ? settings.savedText : "";
  const draft = useDraft(savedText, (text) => onSettings({ day: today, text, ...(isToday ? {} : { savedDocId: "", savedText: "" }) }));
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const text = draft.value.trim();
  const upToDate = Boolean(savedDocId) && text === savedToDoc.trim();

  const save = async () => {
    if (!text || saving) return;
    setSaving(true);
    try {
      const { document } = await openDailyDoc({ date: today });
      const content = upsertJournalSection(document.content, prompt, draft.value);
      await updateDoc(document.id, { content, plainText: docPlainText(content) });
      void queryClient.invalidateQueries({ queryKey: docsKey });
      void queryClient.invalidateQueries({ queryKey: docKey(document.id) });
      onSettings({ day: today, text: draft.value, savedDocId: document.id, savedText: draft.value });
      toast("Saved to today's note");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save to today's note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-sm italic text-foreground">{prompt}</p>
      <textarea
        value={draft.value}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onChange={(event) => draft.onChange(event.target.value)}
        placeholder="Write a few lines…"
        aria-label={prompt}
        className="min-h-0 w-full flex-1 resize-none rounded-lg border border-border bg-input/30 px-2.5 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />
      <div className="flex items-center gap-2 text-xs">
        {upToDate ? (
          <>
            <span className="flex items-center gap-1 text-success">
              <Check className="size-3.5" /> Saved to today&apos;s note
            </span>
            <Link href={fileHref(savedDocId)} className="ml-auto text-primary hover:underline">
              Open
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!text || saving}
            className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : savedDocId ? "Update today's note" : "Save to today's note"}
          </button>
        )}
      </div>
    </div>
  );
}
