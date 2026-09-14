"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  Clock,
  Loader2,
  Moon,
  Plus,
  Star,
  Sun,
} from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import ColorChip from "@/app/_components/_ui/colorChip";
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
import { chipStyle } from "@/app/utils/entityColor";
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
import type { CalendarItem, Task } from "@/app/_types/types";

const MAX_TODAY_FOCUS = 7;
const MEETING_URL = /https?:\/\/[^\s]+(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)[^\s]*/i;

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

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function dueLabel(task: Task, day: string) {
  if (!task.deadline) return null;
  const stamp = /^\d{4}-\d{2}-\d{2}/.test(task.deadline)
    ? task.deadline.slice(0, 10)
    : localDateStamp(new Date(task.deadline));
  if (!stamp) return null;
  if (stamp < day) return `Overdue ${stamp}`;
  if (stamp > day) return `Due ${stamp}`;
  const timed = parseDate(task.deadline);
  if (timed && !/^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && (timed.getHours() !== 0 || timed.getMinutes() !== 0)) {
    return `Due today ${formatTime(timed)}`;
  }
  return "Due End of Day";
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
  if (item.color) return item.color;
  if (item.taskId) return "var(--success)";
  return "var(--primary)";
}

function packAgendaLanes(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const lanes: CalendarItem[][] = [];
  for (const item of sorted) {
    const start = parseDate(item.start)?.getTime() ?? 0;
    const lane = lanes.find((row) => {
      const last = row[row.length - 1];
      return (parseDate(last.end)?.getTime() ?? 0) <= start;
    });
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}

function agendaRange(items: CalendarItem[]) {
  const minutes = items.flatMap((item) => {
    const start = parseDate(item.start);
    const end = parseDate(item.end);
    if (!start || !end) return [];
    return [minutesOfDay(start), minutesOfDay(end)];
  });
  if (minutes.length === 0) return { from: 8 * 60, to: 18 * 60 };
  const from = Math.max(0, Math.min(8 * 60, Math.floor(Math.min(...minutes) / 60) * 60));
  const to = Math.min(24 * 60, Math.max(18 * 60, Math.ceil(Math.max(...minutes) / 60) * 60));
  return { from, to: Math.max(to, from + 60) };
}

function SectionHeading({
  icon,
  title,
  hint,
  extra,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </h2>
        {hint ? <span className="text-xs text-muted-foreground/70">{hint}</span> : null}
      </div>
      {extra}
    </div>
  );
}

function StarGlyph({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <Star
      className={cn("size-4", filled ? "fill-warning text-warning" : "text-muted-foreground", className)}
    />
  );
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
        if (isInboxTask(task) || isReminderTask(task) || task.parentTaskId) return false;
        if (needle && !task.name.toLowerCase().includes(needle)) return false;
        return true;
      })
      .slice(0, 12);
  }, [excludeIds, query, tasks.data]);

  const pick = (task: Task) => {
    void setFocus
      .mutateAsync({ taskId: task.id, date })
      .then(onClose)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not star that task";
        useToastStore.getState().show(message);
      });
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
}) {
  const completed = Boolean(task.completedAt);
  const estimate = task.duration > 0 ? task.duration : null;
  const priorMinutes = task.actualMinutes ?? 0;
  const totalMinutes = priorMinutes + Math.floor(elapsed / 60);
  const overEstimate = focusing && estimate != null && totalMinutes > estimate;
  const due = dueLabel(task, day);
  const progress = progressLabel(task);
  const priority = normalizePriority(task.priorityLevel);

  return (
    <div
      className={cn(
        "group relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border p-3.5 transition-colors",
        completed && "border-border/80 bg-muted/20 opacity-60 hover:opacity-90",
        focusing && "border-primary/40 bg-primary/5",
        !completed && !focusing && "border-border bg-card hover:bg-accent/30",
      )}
    >
      {focusing ? <span className="absolute inset-y-0 left-0 w-1 bg-primary" /> : null}
      <div className={cn("flex min-w-0 items-start gap-3.5", focusing && "pl-2")}>
        <button
          type="button"
          disabled={busy || completed}
          onClick={onComplete}
          aria-label={completed ? `${task.name} completed` : `Complete ${task.name}`}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
            completed
              ? "border-success bg-success/20 text-success"
              : focusing
                ? "border-primary/50 hover:border-primary"
                : "border-muted-foreground/40 hover:border-primary",
          )}
        >
          {completed ? <Check className="size-3.5 stroke-[2.5]" /> : null}
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              className={cn(
                "truncate text-left text-sm font-medium",
                completed ? "text-muted-foreground line-through" : "text-foreground hover:text-primary",
              )}
            >
              {task.name}
            </button>
            {task.project?.title ? (
              <ColorChip color={task.project.color} className="text-[10px]" dot={false}>
                {task.project.title}
              </ColorChip>
            ) : null}
            {priority === "High" || priority === "Urgent" ? (
              <span
                className="rounded border px-2 py-0.5 text-[10px] font-semibold"
                style={chipStyle(priority === "Urgent" ? "#E5484D" : "#F76808")}
              >
                {priority} Priority
              </span>
            ) : null}
            {(task.labels ?? []).slice(0, 2).map((label) => (
              <ColorChip key={label.id} color={label.color} className="text-[10px]" dot={false}>
                {label.name}
              </ColorChip>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                Completed
                {priorMinutes > 0 ? ` in ${formatDuration(priorMinutes)}` : ""}
                {" · "}
                {formatTime(new Date(task.completedAt))}
              </span>
            ) : null}
            {!completed && due ? <span>{due}</span> : null}
            {!completed && estimate != null ? <span>Estimate: {formatDuration(estimate)}</span> : null}
            {!completed && progress ? <span>Subtasks: {progress}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {focusing ? (
          <>
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs",
                overEstimate ? "text-destructive" : "text-primary",
              )}
              title="Elapsed in this session"
            >
              <Loader2 className="size-3.5 animate-spin" />
              {formatElapsed(elapsed)}
            </div>
            <Link
              href={`/calendar?taskId=${encodeURIComponent(task.id)}`}
              className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/40 sm:inline-flex"
            >
              <CalendarClock className="size-3.5" />
              Reschedule
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-60"
            >
              Stop
            </button>
          </>
        ) : completed ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={onStart}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent/40 disabled:opacity-60"
          >
            Start Focus
          </button>
        )}
        <button
          type="button"
          onClick={onUnstar}
          title="Remove from today focus"
          aria-label={`Remove ${task.name} from today focus`}
          className="rounded-md p-1 text-warning hover:bg-accent/40"
        >
          <StarGlyph filled={!completed} className={completed ? "fill-muted-foreground text-muted-foreground" : undefined} />
        </button>
      </div>
    </div>
  );
}

function AgendaTimeline({
  items,
  now,
  onOpen,
}: {
  items: CalendarItem[];
  now: number;
  onOpen: (item: CalendarItem) => void;
}) {
  const { from, to } = agendaRange(items);
  const span = Math.max(to - from, 60);
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => from / 60 + i);
  const nowDate = new Date(now);
  const nowMinutes = minutesOfDay(nowDate);
  const showNow = nowMinutes >= from && nowMinutes <= to;
  const nowLeft = ((nowMinutes - from) / span) * 100;
  const lanes = packAgendaLanes(items);
  const laneHeight = 32;
  const trackHeight = Math.max(lanes.length, 1) * (laneHeight + 6) + 8;

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg bg-background/60" style={{ height: trackHeight }}>
        {lanes.flatMap((lane, laneIndex) =>
          lane.map((item) => {
            const start = parseDate(item.start);
            const end = parseDate(item.end);
            if (!start || !end) return null;
            const left = ((Math.max(minutesOfDay(start), from) - from) / span) * 100;
            const right = ((Math.min(minutesOfDay(end), to) - from) / span) * 100;
            const width = Math.max(right - left, 1.5);
            return (
              <button
                key={item.id}
                type="button"
                title={`${item.title} · ${formatTime(start)} – ${formatTime(end)}`}
                onClick={() => onOpen(item)}
                className="absolute overflow-hidden rounded-md px-2 text-left text-[10px] font-medium text-primary-foreground"
                style={{
                  top: 6 + laneIndex * (laneHeight + 6),
                  height: laneHeight,
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: itemAccent(item),
                }}
              >
                <span className="block truncate leading-8">{item.title}</span>
              </button>
            );
          }),
        )}
        {showNow ? (
          <span
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-foreground"
            style={{ left: `${nowLeft}%` }}
            title="Now"
          />
        ) : null}
      </div>
      <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
        {hours.map((hour, index) => (
          <span
            key={hour}
            className={cn(
              "absolute",
              index === 0 ? "translate-x-0" : index === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            style={{ left: `${((hour * 60 - from) / span) * 100}%` }}
          >
            {formatTime(new Date(2000, 0, 1, hour))}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgendaRow({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  const start = parseDate(item.start);
  const end = parseDate(item.end);
  const accent = itemAccent(item);
  const meet = meetingUrl(item);
  const isTask = Boolean(item.taskId);
  const durationMin =
    start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : 0;
  const badge = item.allDay ? "All day" : isTask ? "Focus block" : "Event";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-stretch gap-0 overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:bg-accent/30"
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: accent }} />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-medium" style={{ color: accent }}>
              {item.allDay || !start || !end
                ? "All day"
                : `${formatTime(start)} – ${formatTime(end)}`}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={chipStyle(accent)}
            >
              {badge}
            </span>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-foreground">{item.title}</h3>
          {item.task?.project?.title || item.event?.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {item.event?.description?.trim() || item.task?.project?.title}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <span className="text-muted-foreground">{durationMin > 0 ? formatDuration(durationMin) : null}</span>
          {meet ? (
            <a
              href={meet}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="font-medium text-primary hover:underline"
            >
              Join call →
            </a>
          ) : (
            <span className="font-medium text-primary">Open →</span>
          )}
        </div>
      </div>
    </button>
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
  const data = today.data;
  const focusingId = data?.focusing?.id;
  const now = useNow(focusingId ? 1000 : 15_000);

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const scheduled = useMemo(() => items.filter((item) => !item.reminder), [items]);
  const reminders = useMemo(() => items.filter((item) => item.reminder), [items]);
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
      .filter((entry): entry is { item: CalendarItem; start: Date } => Boolean(entry.start && entry.start.getTime() > now))
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

  const unstar = (task: Task) => {
    void setFocus.mutateAsync({ taskId: task.id, date: null });
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
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!(event.target instanceof HTMLElement)) return;
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target.isContentEditable) return;
      if (event.key === "Escape" && pickerOpen) {
        event.preventDefault();
        setPickerOpen(false);
        return;
      }
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setPickerOpen(true);
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
    void Promise.all(tasks.map((task) => setFocus.mutateAsync({ taskId: task.id, date }))).then(() => {
      showUndoToast(`Moved ${tasks.length} to tomorrow`, () => {
        void Promise.all(tasks.map((task) => setFocus.mutateAsync({ taskId: task.id, date: data.date })));
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
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 sm:px-8">
        <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Today</h1>
              {data?.focusing ? (
                <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                  Focus Mode
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">{dateLabel}</span>
              {inboxCount > 0 ? (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <Link href="/inbox" className="font-medium text-warning hover:underline">
                    {inboxCount} item{inboxCount === 1 ? "" : "s"} in inbox
                  </Link>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {focusLoggedMinutes > 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-semibold text-primary">{formatDuration(focusLoggedMinutes)}</span> focus logged
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={remainingSlots <= 0}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="size-4" />
              Star Priority (P)
            </button>
          </div>
        </header>

        <div className={cn("mt-6 space-y-7", inboxCount > 0 ? "pb-28" : "pb-8")}>
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
              <section className="space-y-3">
                <SectionHeading
                  icon={<Star className="size-3.5 fill-primary text-primary" />}
                  title="Today Focus"
                  hint="Star up to 7 tasks to complete today. Independent of deadlines."
                  extra={
                    focusTotal > 0 ? (
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <span>Progress:</span>
                        <span className="text-primary">
                          {focusCompleteCount}/{focusTotal} completed
                        </span>
                        {remainingEstimate > 0 ? (
                          <>
                            <span className="text-border">•</span>
                            <span>{formatDuration(remainingEstimate)} remaining</span>
                          </>
                        ) : null}
                      </div>
                    ) : null
                  }
                />
                <div className="space-y-2.5 rounded-2xl border border-border bg-muted/20 p-4">
                  {focusRows.length === 0 ? (
                    <p className="px-1 py-3 text-sm text-muted-foreground">
                      Star up to 7 tasks from here or a task detail. This set is independent of deadlines.
                    </p>
                  ) : (
                    focusRows.map((task) => (
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
                        onStart={() => void startFocus.mutateAsync(task.id)}
                        onStop={() => void stopFocus.mutateAsync(task.id)}
                        onUnstar={() => unstar(task)}
                      />
                    ))
                  )}
                  <button
                    type="button"
                    disabled={remainingSlots <= 0}
                    onClick={() => setPickerOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-accent/30 hover:text-primary disabled:opacity-50"
                  >
                    <Plus className="size-4" />
                    {remainingSlots > 0
                      ? `Assign task to Today’s Focus list (${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} available)`
                      : "Today’s Focus is full (7/7)"}
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading
                  icon={<Clock className="size-3.5 text-primary" />}
                  title="Scheduled Agenda"
                  hint="Reserved blocks and events, placed on today’s clock"
                  extra={
                    nextEvent ? (
                      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="size-2 rounded-full bg-success" />
                        Next: {nextEvent.item.title} in {formatCountdown(nextEvent.start.getTime() - now)}
                      </span>
                    ) : null
                  }
                />
                {scheduled.length === 0 ? (
                  <p className="rounded-2xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                    Nothing on the calendar today.
                  </p>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
                    {timedScheduled.length > 0 ? (
                      <AgendaTimeline items={timedScheduled} now={now} onOpen={openItem} />
                    ) : null}
                    {allDayScheduled.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {allDayScheduled.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => openItem(item)}
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent/40"
                            >
                              {item.title}
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                                All day
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="space-y-2">
                      {timedScheduled.map((item) => (
                        <AgendaRow key={item.id} item={item} onOpen={() => openItem(item)} />
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <SectionHeading
                  icon={<Bell className="size-3.5 text-warning" />}
                  title="Reminders"
                  extra={
                    <button
                      type="button"
                      onClick={openReminder}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      + New Reminder
                    </button>
                  }
                />
                {reminders.length === 0 ? (
                  <p className="rounded-2xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                    No reminders today.
                  </p>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-muted/20">
                    {reminders.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openItem(item)}
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-3.5 text-left hover:bg-accent/30"
                      >
                        <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                        <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
                          {formatTime(new Date(item.start))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {data.overdue.length > 0 ? (
                <section className="space-y-3">
                  <SectionHeading
                    icon={<CalendarClock className="size-3.5 text-destructive" />}
                    title="Overdue"
                    hint="Past the deadline or last reserved block"
                  />
                  <ul className="space-y-2 rounded-2xl border border-border bg-muted/20 p-4">
                    {data.overdue.map((task) => (
                      <li key={task.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openTask(task.id)}
                          className="min-w-0 flex-1 truncate rounded-xl border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent/40"
                        >
                          {task.name}
                          {task.deadline ? (
                            <span className="ml-2 text-xs text-destructive">{task.deadline}</span>
                          ) : null}
                        </button>
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

              <section className="space-y-3">
                <SectionHeading
                  icon={<Moon className="size-3.5 text-chart-3" />}
                  title="End Of Day Shutdown & Reflection"
                />
                <div className="flex flex-col items-stretch justify-between gap-5 rounded-2xl border border-border bg-gradient-to-r from-muted/40 via-card to-primary/5 p-5 md:flex-row md:items-center">
                  <div className="grid w-full grid-cols-3 gap-6 md:w-auto">
                    <Metric
                      label="Completed"
                      value={data.completedToday.length}
                      hint={focusTotal > 0 ? `/ ${focusTotal} tasks` : undefined}
                      tone="success"
                    />
                    <Metric label="Unfinished" value={data.unfinished.length} tone="warning" />
                    <Metric label="Scheduled Tomorrow" value={data.tomorrowFocus.length} tone="primary" />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={planTomorrow}
                      className="rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs font-semibold hover:bg-accent/40"
                    >
                      Plan Tomorrow
                    </button>
                    <button
                      type="button"
                      onClick={eveningShutdown}
                      className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/15 px-4 py-2 text-xs font-semibold text-primary"
                    >
                      <Check className="size-3.5" />
                      Start Evening Shutdown
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {inboxCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-6 bottom-6 flex items-center justify-between gap-3 sm:inset-x-8">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/90 px-4 py-2.5 shadow-lg backdrop-blur-xl">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-warning" />
            </span>
            <span className="text-xs">
              <span className="font-semibold">{inboxCount} inbox item{inboxCount === 1 ? "" : "s"}</span> waiting to be triaged
            </span>
            <Link href="/inbox" className="inline-flex items-center gap-1 pl-1 text-xs font-medium text-primary hover:underline">
              Review inbox
              <ArrowRight className="size-3" />
            </Link>
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              G then I
            </kbd>
          </div>
          <div className="pointer-events-auto hidden items-center gap-2 rounded-full border border-border bg-background/90 px-3.5 py-1.5 text-[11px] text-muted-foreground md:flex">
            <span>Quick search</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            <span className="text-border">•</span>
            <span>New task</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">C</kbd>
          </div>
        </div>
      ) : null}

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
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="flex flex-col border-border md:border-l md:pl-6 md:first:border-0 md:first:pl-0">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("mt-0.5 flex items-baseline gap-1 text-xl font-bold", color)}>
        {value}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
    </div>
  );
}
