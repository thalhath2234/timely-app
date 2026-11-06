"use client";

import { StrikeTitle, TaskCheck } from "@/app/_components/_ui/taskCheck";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, Clock, Film, Moon, Plus, Star, Sun } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import EventDialog from "@/app/_components/calendarView/eventDialog";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import {
  addCalendarDays,
  addDays,
  dateFromDateInput,
  formatDuration,
  formatTime,
  localDateStamp,
  toCalendarEvents,
  type CalendarEvent,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import { chipStyle, taskEntityColor } from "@/app/utils/entityColor";
import { useToday } from "@/app/utils/hooks/calendar";
import {
  useInboxTasks,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useTasks,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { normalizePriority } from "@/app/utils/priority";
import { isInboxTask, isReminderTask } from "@/app/utils/taskFilters";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { useCalendarContextMenu } from "@/app/utils/hooks/useCalendarContextMenu";
import type { CalendarItem, Task } from "@/app/_types/types";
import { calendarItemDone } from "@timely/contract/calendar";
import { entityTitleKey } from "@/app/utils/titleMorph";
import TodaySuggestions from "@/app/_components/today/todaySuggestions";
import HabitsGoals from "@/app/_components/today/habitsGoals";
import DayTimeline from "@/app/_components/today/dayTimeline";
import TodayPanel from "@/app/_components/today/todayPanel";
import WeekReviewDialog from "@/app/_components/today/weekReview";
import PageWithRail from "@/app/_components/_ui/pageWithRail";
import ScreenTip from "@/app/_components/_ui/screenTip";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";

const MAX_TODAY_FOCUS = 7;
const MEETING_URL = /https?:\/\/[^\s]+(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)[^\s]*/i;

function reportMutationError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  useToastStore.getState().show(message);
}

function runMutation(action: Promise<unknown>, fallback: string) {
  void action.catch((error: unknown) => reportMutationError(error, fallback));
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deadlineStamp(deadline: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(deadline) ? deadline.slice(0, 10) : localDateStamp(new Date(deadline));
}

function shortDay(stamp: string) {
  return dateFromDateInput(stamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueLabel(task: Task, day: string) {
  if (!task.deadline) return null;
  const stamp = deadlineStamp(task.deadline);
  if (!stamp) return null;
  if (stamp < day) return `Overdue ${shortDay(stamp)}`;
  if (stamp > day) return `Due ${shortDay(stamp)}`;
  const timed = parseDate(task.deadline);
  if (timed && !/^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && (timed.getHours() !== 0 || timed.getMinutes() !== 0)) {
    return `Due today ${formatTime(timed)}`;
  }
  return "Due today";
}

function progressLabel(task: Task) {
  const done = task.progressDone ?? task.checklistDone ?? 0;
  const total = task.progressTotal ?? task.checklistTotal ?? 0;
  if (total <= 0) return null;
  return `${done} of ${total}`;
}

function meetingUrl(item: CalendarItem) {
  const text = [item.event?.description, item.task?.description].filter(Boolean).join("\n");
  return text.match(MEETING_URL)?.[0] ?? null;
}

function itemAccent(item: CalendarItem) {
  if (item.task) return taskEntityColor(item.task);
  if (item.color) return item.color;
  return "var(--primary)";
}

function StarPicker({
  date,
  excludeIds,
  remaining,
  onClose,
}: {
  date: string;
  excludeIds: Set<string>;
  remaining: number;
  onClose: () => void;
}) {
  const tasks = useTasks();
  const setFocus = useSetTodayFocus();
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (tasks.data ?? [])
      .filter((task) => {
        if (excludeIds.has(task.id)) return false;
        if (task.completedAt) return false;
        if (isInboxTask(task) || isReminderTask(task)) return false;
        if (needle && !task.name.toLowerCase().includes(needle)) return false;
        return true;
      })
      .slice(0, 12);
  }, [excludeIds, query, tasks.data]);

  const pick = (task: Task) => {
    runMutation(setFocus.mutateAsync({ taskId: task.id, date }).then(onClose), "Could not star that task");
  };

  return (
    <div
      role="dialog"
      aria-label="Star a task for today"
      className="flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={remaining > 0 ? `Star a task · ${remaining} slot${remaining === 1 ? "" : "s"} left` : "Today focus is full"}
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <ul className="flex-1 overflow-y-auto p-1">
        {candidates.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            {tasks.isLoading ? "Loading tasks…" : "No matching open tasks."}
          </li>
        ) : (
          candidates.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                disabled={remaining <= 0 || setFocus.isPending}
                onClick={() => pick(task)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent/50 disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{task.name}</span>
                {task.project?.title ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{task.project.title}</span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Today focus has seven slots: done, still open, and free. */
function SlotMeter({ done, open }: { done: number; open: number }) {
  return (
    <span
      className="flex gap-0.5"
      role="img"
      aria-label={`${done} done, ${open} open, ${Math.max(0, MAX_TODAY_FOCUS - done - open)} free of ${MAX_TODAY_FOCUS} slots`}
    >
      {Array.from({ length: MAX_TODAY_FOCUS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-3 rounded-full",
            i < done ? "bg-success" : i < done + open ? "bg-primary" : "bg-muted-foreground/20",
          )}
        />
      ))}
    </span>
  );
}

function FocusTaskRow({
  task,
  day,
  focusing,
  elapsed,
  busy,
  onOpen,
  onComplete,
  onStart,
  onStop,
  onUnstar,
  onContextMenu,
}: {
  task: Task;
  day: string;
  focusing: boolean;
  elapsed: number;
  busy: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onStart: () => void;
  onStop: () => void;
  onUnstar: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const completed = Boolean(task.completedAt);
  const estimate = task.duration > 0 ? task.duration : null;
  const priorMinutes = task.actualMinutes ?? 0;
  const totalMinutes = priorMinutes + Math.floor(elapsed / 60);
  const overEstimate = focusing && estimate != null && totalMinutes > estimate;
  const due = dueLabel(task, day);
  const overdue = due?.startsWith("Overdue");
  const progress = progressLabel(task);
  const priority = normalizePriority(task.priorityLevel);
  const place = task.project?.title || task.workspace?.name;

  return (
    <li
      className={cn(
        "flex items-center gap-3 border-t border-border px-1 py-2.5 first:border-t-0",
        focusing && "-mx-2 rounded-md border-t-0 bg-primary/5 px-3",
      )}
      onContextMenu={onContextMenu}
    >
      <span
        aria-hidden
        className="w-[3px] self-stretch rounded-full"
        style={{ backgroundColor: focusing ? "var(--primary)" : taskEntityColor(task) }}
      />
      <TaskCheck
        shape="square"
        checked={completed}
        disabled={busy}
        onToggle={onComplete}
        label={completed ? `Reopen ${task.name}` : `Complete ${task.name}`}
        className={cn(!completed && focusing && "border-primary/60")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            data-entity-title={entityTitleKey("task", task.id)}
            className={cn(
              "min-w-0 truncate text-left text-sm font-medium",
              completed ? "text-muted-foreground" : "text-foreground hover:text-primary",
            )}
          >
            <StrikeTitle done={completed}>{task.name}</StrikeTitle>
          </button>
          {!completed && (priority === "High" || priority === "Urgent") ? (
            <span
              className="shrink-0 rounded-full border px-2 py-px text-[10px] font-medium"
              style={chipStyle(priority === "Urgent" ? "#E5484D" : "#F76808")}
            >
              {priority}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
          {focusing ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              Focusing now
            </span>
          ) : null}
          {completed && task.completedAt ? (
            <span>
              Done
              {priorMinutes > 0 ? ` in ${formatDuration(priorMinutes)}` : ""}
              {" · "}
              {formatTime(new Date(task.completedAt))}
            </span>
          ) : null}
          {!completed && due ? <span className={cn(overdue && "text-destructive")}>{due}</span> : null}
          {!completed && estimate != null ? <span>{formatDuration(estimate)}</span> : null}
          {!completed && progress ? <span>Checklist {progress}</span> : null}
          {place && !completed ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: taskEntityColor(task) }} />
              <span className="truncate">{place}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {focusing ? (
          <>
            <span
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs tabular-nums",
                overEstimate ? "text-destructive" : "text-primary",
              )}
              title="Elapsed in this session"
            >
              <LogoSpinner size={12} tone="mono" label="Focusing" />
              {formatElapsed(elapsed)}
            </span>
            <Link
              href={`/calendar?taskId=${encodeURIComponent(task.id)}`}
              className={buttonClass({ variant: "ghost", size: "sm", className: "hidden 2xl:inline-flex" })}
            >
              <CalendarClock />
              Reschedule
            </Link>
            <Button variant="outline" size="sm" disabled={busy} onClick={onStop}>
              Stop
            </Button>
          </>
        ) : completed ? null : (
          <Button variant="outline" size="sm" disabled={busy} onClick={onStart}>
            Start focus
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onUnstar}
          title="Remove from today focus"
          aria-label={`Remove ${task.name} from today focus`}
        >
          <Star
            className={cn(
              completed ? "fill-muted-foreground/60 text-muted-foreground/60" : "fill-warning text-warning",
            )}
          />
        </Button>
      </div>
    </li>
  );
}

export default function TodayDashboard() {
  const today = useToday();
  const inbox = useInboxTasks();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const updateTask = useUpdateTask();
  const router = useRouter();
  const setSelectedDate = useCalendarStore((state) => state.setSelectedDate);
  const setActiveView = useCalendarStore((state) => state.setActiveView);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const { eventMenu } = useCalendarContextMenu({
    onOpenEvent: (event) => setOpenEventId(event.id),
  });
  const data = today.data;
  const focusingId = data?.focusing?.id;
  const now = useNow(focusingId ? 1000 : 15_000);

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const scheduled = useMemo(() => items.filter((item) => !item.reminder), [items]);
  const reminders = useMemo(
    () => items.filter((item) => item.reminder).sort((a, b) => a.start.localeCompare(b.start)),
    [items],
  );
  const timedScheduled = useMemo(
    () => scheduled.filter((item) => !item.allDay).sort((a, b) => a.start.localeCompare(b.start)),
    [scheduled],
  );
  const allDayScheduled = useMemo(() => scheduled.filter((item) => item.allDay), [scheduled]);

  const calendarEvents = useMemo(() => toCalendarEvents(items), [items]);
  const openEvent = useMemo<CalendarEvent | null>(
    () => calendarEvents.find((event) => event.id === openEventId) ?? null,
    [calendarEvents, openEventId],
  );

  const nextEvent = useMemo(() => {
    const upcoming = timedScheduled
      .map((item) => ({ item, start: parseDate(item.start) }))
      .filter((entry): entry is { item: CalendarItem; start: Date } => Boolean(entry.start && entry.start.getTime() > now && !calendarItemDone(entry.item)))
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    return upcoming ?? null;
  }, [now, timedScheduled]);

  const openItem = (item: CalendarItem) => {
    if (item.taskId) {
      openTask(item.taskId);
      return;
    }
    setOpenEventId(item.id);
  };

  const onItemContextMenu = (event: React.MouseEvent, item: CalendarItem) => {
    // A day of a repeating task gets the calendar's occurrence menu: the task
    // menu's Mark complete would finish the whole series.
    if (item.task && item.kind !== "taskOccurrence") {
      openMenu(event, taskMenu(item.task), { title: item.task.name });
      return;
    }
    const calendarEvent = calendarEvents.find((entry) => entry.id === item.id);
    if (calendarEvent) {
      openMenu(event, eventMenu(calendarEvent), { title: calendarEvent.title });
    }
  };

  const completeTask = (task: Task) => {
    const previous = task.completedAt ?? "";
    const next = task.completedAt ? "" : new Date().toISOString();
    runMutation(
      updateTask.mutateAsync({ id: task.id, completedAt: next }).then(() => {
        showUndoToast(`${next ? "Completed" : "Reopened"} “${task.name}”`, () => {
          runMutation(
            updateTask.mutateAsync({ id: task.id, completedAt: previous }),
            "Could not undo complete",
          );
        });
      }),
      "Could not complete task",
    );
  };

  const stopAndComplete = (task: Task) => {
    runMutation(stopFocus.mutateAsync(task.id).then(() => completeTask(task)), "Could not stop focus");
  };

  const unstar = (task: Task) => {
    runMutation(setFocus.mutateAsync({ taskId: task.id, date: null }), "Could not remove from today");
  };

  const mutating = stopFocus.isPending || updateTask.isPending || startFocus.isPending;

  const focusRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.todayFocus];
    if (data.focusing && !rows.some((task) => task.id === data.focusing!.id)) {
      rows.unshift(data.focusing);
    }
    const focusing = data.focusing;
    const incomplete = rows.filter((task) => !task.completedAt && task.id !== focusing?.id);
    const completed = rows.filter((task) => task.completedAt);
    const active = focusing ? rows.filter((task) => task.id === focusing.id) : [];
    return [...active, ...incomplete, ...completed];
  }, [data]);

  const focusCompleteCount = data?.todayFocus.filter((task) => task.completedAt).length ?? 0;
  const focusTotal = data?.todayFocus.length ?? 0;
  const remainingEstimate = (data?.todayFocus ?? [])
    .filter((task) => !task.completedAt)
    .reduce((sum, task) => sum + Math.max(task.duration ?? 0, 0), 0);
  const remainingSlots = Math.max(0, MAX_TODAY_FOCUS - focusTotal);
  const focusLoggedMinutes = useMemo(() => {
    if (!data) return 0;
    const ids = new Set<string>();
    let minutes = 0;
    for (const task of [...data.completedToday, ...data.todayFocus, data.focusing].filter(Boolean) as Task[]) {
      if (ids.has(task.id)) continue;
      ids.add(task.id);
      minutes += task.actualMinutes ?? 0;
    }
    if (data.focusing?.focusStartedAt) {
      const started = parseDate(data.focusing.focusStartedAt)?.getTime();
      if (started) minutes += Math.floor(Math.max(0, now - started) / 60_000);
    }
    return minutes;
  }, [data, now]);
  const inboxCount = inbox.data?.length ?? data?.inboxCount ?? 0;
  const elapsed = data?.focusing?.focusStartedAt
    ? Math.max(0, Math.floor((now - (parseDate(data.focusing.focusStartedAt)?.getTime() ?? now)) / 1000))
    : 0;

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const openReminder = () => {
    setCreateTaskDraft({ kind: "reminder" });
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  const planTomorrow = () => {
    if (!data) return;
    const tomorrow = addDays(dateFromDateInput(data.date), 1);
    setSelectedDate(tomorrow, 1);
    setActiveView("day");
    router.push("/calendar?view=day");
  };

  const eveningShutdown = () => {
    if (!data) return;
    const date = addCalendarDays(data.date, 1);
    const tasks = data.unfinished;
    if (tasks.length === 0) {
      useToastStore.getState().show("Nothing left to shut down.");
      return;
    }
    void Promise.allSettled(tasks.map((task) => setFocus.mutateAsync({ taskId: task.id, date }))).then((results) => {
      const moved = tasks.filter((_, index) => results[index]?.status === "fulfilled");
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        reportMutationError(failed.reason, "Could not move some tasks to tomorrow");
      }
      if (moved.length === 0) return;
      showUndoToast(`Moved ${moved.length} to tomorrow`, () => {
        void Promise.allSettled(
          moved.map((task) => setFocus.mutateAsync({ taskId: task.id, date: data.date })),
        ).then((undoResults) => {
          const undoFailed = undoResults.find((result) => result.status === "rejected");
          if (undoFailed?.status === "rejected") {
            reportMutationError(undoFailed.reason, "Could not undo shutdown");
          }
        });
      });
    });
  };

  const dateLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "Your day";

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-y-auto">
        <PageHeader
          title="Today"
          bordered
          badge={data?.focusing ? <PageBadge tone="primary">Focus mode</PageBadge> : null}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{dateLabel}</span>
              {inboxCount > 0 ? (
                <>
                  <span aria-hidden className="size-1 rounded-full bg-border" />
                  <Link href="/inbox" className="font-medium text-warning hover:underline">
                    {inboxCount} in inbox
                  </Link>
                </>
              ) : null}
              {focusLoggedMinutes > 0 ? (
                <>
                  <span aria-hidden className="size-1 rounded-full bg-border" />
                  <span>
                    <span className="font-medium text-foreground">{formatDuration(focusLoggedMinutes)}</span> focus logged
                  </span>
                </>
              ) : null}
            </span>
          }
          actions={
            <Button
              onClick={() => setPickerOpen(true)}
              disabled={remainingSlots <= 0}
              leading={<Star />}
              title="Star a task for today"
            >
              Add to focus
            </Button>
          }
        />

        <div className="flex-1 px-6 py-5">
          {today.isError && data ? (
            <div className="mb-4">
              <LoadErrorBanner
                what="today"
                error={today.error}
                onRetry={() => today.refetch()}
                retrying={today.isFetching}
              />
            </div>
          ) : null}

          {today.isLoading ? (
            <SkeletonRows rows={6} height={46} />
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
            // The day board: what to do (focus, suggestions) and when it happens
            // (the day's clock) side by side from 1024px; the small things
            // (habits, goals, reminders, overdue, wrap-up) in the rail from
            // 1280px, under the board in two columns below that.
            <PageWithRail
              data-testid="today-board"
              railWidth={300}
              rail={
                <>
                  <HabitsGoals today={data.date} version={String(today.dataUpdatedAt)} />

                  <TodayPanel
                    title="Reminders"
                    icon={<Bell className="size-3.5 text-warning" />}
                    data-testid="today-reminders"
                    action={
                      <Button variant="ghost" size="sm" leading={<Plus />} onClick={openReminder}>
                        New
                      </Button>
                    }
                  >
                    {reminders.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No reminders today.</p>
                    ) : (
                      <ul>
                        {reminders.map((item) => (
                          <li key={item.id} className="border-t border-border first:border-t-0">
                            <button
                              type="button"
                              onClick={() => openItem(item)}
                              onContextMenu={(event) => onItemContextMenu(event, item)}
                              className="flex w-full items-center gap-3 rounded-md py-1.5 text-left hover:bg-muted/60"
                            >
                              <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                                {formatTime(new Date(item.start))}
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-sm",
                                  calendarItemDone(item) && "text-muted-foreground line-through",
                                )}
                              >
                                {item.title}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TodayPanel>

                  {data.overdue.length > 0 ? (
                    <TodayPanel
                      title="Overdue"
                      icon={<CalendarClock className="size-3.5 text-destructive" />}
                      titleClassName="text-destructive"
                      data-testid="today-overdue"
                      meta={`${data.overdue.length} task${data.overdue.length === 1 ? "" : "s"}`}
                    >
                      <ul>
                        {data.overdue.map((task) => (
                          <li
                            key={task.id}
                            className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0"
                          >
                            <button
                              type="button"
                              onClick={() => openTask(task.id)}
                              onContextMenu={(event) => openMenu(event, taskMenu(task), { title: task.name })}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span
                                data-entity-title={entityTitleKey("task", task.id)}
                                className="block truncate text-sm hover:text-primary"
                              >
                                {task.name}
                              </span>
                              {task.deadline ? (
                                <span className="block text-xs text-destructive">
                                  Due {shortDay(deadlineStamp(task.deadline))}
                                </span>
                              ) : null}
                            </button>
                            <Link
                              href={`/calendar?taskId=${encodeURIComponent(task.id)}`}
                              className={buttonClass({ variant: "outline", size: "sm" })}
                            >
                              Reschedule
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </TodayPanel>
                  ) : null}

                  <TodayPanel
                    title="End of day"
                    icon={<Moon className="size-3.5 text-chart-3" />}
                    data-testid="today-shutdown"
                  >
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      <Metric
                        label="Done"
                        value={data.completedToday.length}
                        hint={focusTotal > 0 ? `of ${focusTotal}` : undefined}
                        tone="success"
                      />
                      <Metric label="Unfinished" value={data.unfinished.length} tone="warning" />
                      <Metric label="Tomorrow" value={data.tomorrowFocus.length} tone="primary" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={planTomorrow}>
                        Plan tomorrow
                      </Button>
                      <Button
                        variant="soft"
                        size="sm"
                        leading={<Moon />}
                        onClick={eveningShutdown}
                        title="Move unfinished focus tasks to tomorrow"
                      >
                        Shut down day
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        leading={<Film />}
                        onClick={() => setReviewOpen(true)}
                        title="This week as a short video you can save"
                        data-testid="today-week-review"
                      >
                        Week in review
                      </Button>
                    </div>
                  </TodayPanel>
                </>
              }
            >
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <TodayPanel
                  title="Today focus"
                  icon={<Star className="size-3.5 fill-warning text-warning" />}
                  data-testid="today-focus"
                  meta={
                    focusTotal > 0 ? (
                      <span className="flex items-center gap-2.5">
                        <span className="tabular-nums">
                          {focusCompleteCount} of {focusTotal} done
                          {remainingEstimate > 0 ? ` · ${formatDuration(remainingEstimate)} left` : ""}
                        </span>
                        <SlotMeter done={focusCompleteCount} open={focusTotal - focusCompleteCount} />
                      </span>
                    ) : (
                      <span>Up to {MAX_TODAY_FOCUS} tasks, whatever their deadlines</span>
                    )
                  }
                >
                  {focusRows.length === 0 ? (
                    <p className="pb-2 text-sm text-muted-foreground">
                      Nothing starred yet. Star a task here or from its detail panel.
                    </p>
                  ) : (
                    <ul>
                      {focusRows.map((task) => (
                        <FocusTaskRow
                          key={task.id}
                          task={task}
                          day={data.date}
                          focusing={data.focusing?.id === task.id}
                          elapsed={data.focusing?.id === task.id ? elapsed : 0}
                          busy={mutating}
                          onOpen={() => openTask(task.id)}
                          onComplete={() => {
                            if (data.focusing?.id === task.id) stopAndComplete(task);
                            else completeTask(task);
                          }}
                          onStart={() => runMutation(startFocus.mutateAsync(task.id), "Could not start focus")}
                          onStop={() => runMutation(stopFocus.mutateAsync(task.id), "Could not stop focus")}
                          onUnstar={() => unstar(task)}
                          onContextMenu={(event) => openMenu(event, taskMenu(task), { title: task.name })}
                        />
                      ))}
                    </ul>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remainingSlots <= 0}
                    onClick={() => setPickerOpen(true)}
                    leading={<Plus />}
                    className="mt-1"
                  >
                    {remainingSlots > 0
                      ? `Add a task · ${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} left`
                      : `Today focus is full (${MAX_TODAY_FOCUS} of ${MAX_TODAY_FOCUS})`}
                  </Button>
                </TodayPanel>

                <ScreenTip screen="today" />

                <TodaySuggestions
                  date={data.date}
                  slotsLeft={remainingSlots}
                  version={`${data.todayFocus.map((task) => task.id).join(",")}|${scheduled.map((item) => item.id).join(",")}`}
                />
              </div>

                <TodayPanel
                  title="Schedule"
                  icon={<Clock className="size-3.5 text-primary" />}
                  data-testid="today-schedule"
                  meta={
                    nextEvent ? (
                      <span
                        className="inline-flex min-w-0 items-center gap-1.5"
                        title={`Next: ${nextEvent.item.title} at ${formatTime(nextEvent.start)}`}
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-success" />
                        <span className="shrink-0">Next in {formatCountdown(nextEvent.start.getTime() - now)}</span>
                        <span className="hidden truncate 2xl:inline">· {nextEvent.item.title}</span>
                      </span>
                    ) : null
                  }
                >
                  {allDayScheduled.length > 0 ? (
                    <ul className="mb-3 flex flex-wrap gap-1.5">
                      {allDayScheduled.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => openItem(item)}
                            onContextMenu={(event) => onItemContextMenu(event, item)}
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                            style={chipStyle(itemAccent(item))}
                          >
                            {item.title}
                            <span className="text-[10px] opacity-80">All day</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <DayTimeline
                    items={timedScheduled}
                    reminders={reminders}
                    now={now}
                    accent={itemAccent}
                    meetingUrl={meetingUrl}
                    onOpen={openItem}
                    onContextMenu={onItemContextMenu}
                  />
                  {scheduled.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Nothing on the calendar today.{" "}
                      <Link href="/calendar" className="font-medium text-primary hover:underline">
                        Open Calendar
                      </Link>
                    </p>
                  ) : null}
                </TodayPanel>

              </div>
            </PageWithRail>
          )}
        </div>
      </div>

      {reviewOpen ? <WeekReviewDialog onClose={() => setReviewOpen(false)} /> : null}
      {pickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[18vh] backdrop-blur-[2px]"
          onMouseDown={() => setPickerOpen(false)}
        >
          <StarPicker
            date={data?.date ?? localDateStamp()}
            excludeIds={new Set((data?.todayFocus ?? []).map((task) => task.id))}
            remaining={remainingSlots}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      ) : null}

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

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: "success" | "warning" | "primary";
}) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2.5 py-2">
      <span className={cn("flex items-baseline gap-1 text-lg font-semibold tabular-nums leading-6", color)}>
        {value}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
