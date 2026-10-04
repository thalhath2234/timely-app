import { EventDialog } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

// The calendar page opens this dialog with a CalendarEvent built from the
// GET /calendar payload. Cells read the same payload from the sample workspace
// and map one item the way utils/calendar `toCalendarEvents` does (not exported).
// The dialog is position:fixed (not portaled); the transformed frame is its containing block.
const Frame = ({ children, root }: { children: React.ReactNode; root?: React.Ref<HTMLDivElement> }) => (
  <div ref={root} className="bg-muted" style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", transform: "translateZ(0)" }}>{children}</div>
);

type Item = Record<string, any>;

function day(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function toEvent(item: Item) {
  const start = new Date(item.start);
  const end = new Date(item.end);
  const isTask = item.kind === "task" || item.kind === "taskOccurrence";
  const task = item.task;
  const reminder = Boolean(item.reminder || (isTask && (task?.duration ?? 1) <= 0));
  const minutes = reminder ? 20 : Math.round((end.getTime() - start.getTime()) / 60_000) || 30;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    start,
    end,
    startHour: startMinutes / 60,
    endHour: Math.min(startMinutes + minutes, 1440) / 60,
    durationMinutes: minutes,
    allDay: item.allDay,
    color: isTask ? task?.project?.color ?? task?.workspace?.color ?? null : item.color ?? null,
    colorLabel: isTask ? task?.project?.title ?? null : "Events",
    statusName: isTask ? task?.status?.name ?? null : null,
    subtitle: null,
    task,
    event: item.event,
    blockId: item.blockId,
    blockIds: item.blockId ? [item.blockId] : [],
    source: item.source,
    chunkIndex: item.chunkIndex ?? 0,
    chunkCount: item.chunkCount ?? 1,
    seriesId: item.seriesId,
    originalStart: item.originalStart ? new Date(item.originalStart) : undefined,
    moved: Boolean(item.moved),
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    item,
    reminder,
  };
}

function Open({ pick, after }: { pick: (item: Item) => boolean; after?: (root: HTMLElement) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [event, setEvent] = useState<ReturnType<typeof toEvent> | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ from: day(-2).toISOString(), to: day(4).toISOString() });
    fetch(`/api-proxy/calendar?${params}`)
      .then((r) => r.json())
      .then((range: { items: Item[] }) => {
        const item = range.items.find(pick);
        if (item) setEvent(toEvent(item));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!event || !after) return;
    const timer = window.setTimeout(() => root.current && after(root.current), 30);
    return () => window.clearTimeout(timer);
  }, [event, after]);
  return (
    <Frame root={root}>
      {event ? <EventDialog event={event as never} onClose={() => undefined} onOpenTask={() => undefined} /> : null}
    </Frame>
  );
}

const isToday = (item: Item) => new Date(item.start).toDateString() === day(0).toDateString();
const clickButton = (label: string) => (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === label)?.click();

export const AutoScheduledBlock = () => (
  <Open pick={(i) => i.kind === "task" && i.taskId === "tsk_welcome_wireframes" && isToday(i)} />
);

export const PinnedBlock = () => (
  <Open pick={(i) => i.kind === "task" && i.taskId === "tsk_spacing_tokens"} />
);

export const OneOffEvent = () => <Open pick={(i) => i.kind === "event" && i.eventId === "evt_critique"} />;

export const RepeatingEvent = () => (
  <Open pick={(i) => i.kind === "eventOccurrence" && i.title === "Design team standup" && isToday(i)} />
);

export const DeleteOccurrence = () => (
  <Open
    pick={(i) => i.kind === "eventOccurrence" && i.title === "Design team standup" && isToday(i)}
    after={clickButton("Delete")}
  />
);

export const Reminder = () => <Open pick={(i) => i.taskId === "tsk_call_dentist"} />;

export const RepeatingReminder = () => <Open pick={(i) => i.kind === "taskOccurrence" && i.taskId === "tsk_weekly_update"} />;
