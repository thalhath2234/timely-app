import { TimeGrid } from "@timely/ui";

type Kind = "task" | "event" | "taskOccurrence" | "eventOccurrence";

const COLORS = {
  web: "#3E63DD", // Website relaunch
  research: "#12A594", // Research
  personal: "#F76808", // Personal
  events: null as string | null, // standalone events use the accent
};

function day(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

let seq = 0;
function ev(
  offset: number,
  startHour: number,
  endHour: number,
  title: string,
  opts: {
    kind?: Kind;
    color?: keyof typeof COLORS;
    label?: string;
    status?: string;
    subtitle?: string;
    allDay?: boolean;
    reminder?: boolean;
    done?: boolean;
  } = {},
) {
  const kind = opts.kind ?? "task";
  const base = day(offset);
  const start = new Date(base.getTime() + startHour * 3_600_000);
  const end = new Date(base.getTime() + endHour * 3_600_000);
  const id = `cal_${++seq}`;
  const color = opts.color ? COLORS[opts.color] : null;
  const isTask = kind === "task" || kind === "taskOccurrence";
  return {
    id,
    kind,
    title,
    start,
    end,
    startHour,
    endHour,
    durationMinutes: Math.round((endHour - startHour) * 60),
    allDay: !!opts.allDay,
    color,
    colorLabel: opts.label ?? (isTask ? "Website relaunch" : "Events"),
    statusName: opts.status ?? (isTask ? "In progress" : null),
    subtitle: opts.subtitle ?? null,
    blockId: isTask && !opts.reminder ? `blk_${id}` : undefined,
    blockIds: isTask && !opts.reminder ? [`blk_${id}`] : [],
    chunkIndex: 0,
    chunkCount: 1,
    moved: false,
    completedAt: opts.done ? end : null,
    reminder: !!opts.reminder,
    item: {
      id,
      kind,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: !!opts.allDay,
      color,
      chunkIndex: 0,
      chunkCount: 1,
      taskId: isTask ? `task_${id}` : undefined,
    },
  };
}

const ws = () => -new Date().getDay(); // offset of this week's Sunday

const weekEvents = () => {
  seq = 0;
  const s = ws();
  return [
    // Monday
    ev(s + 1, 9, 9.5, "Weekly planning", { kind: "eventOccurrence", subtitle: "Recurring · Mondays" }),
    ev(s + 1, 10, 12, "Draft onboarding flow", { color: "web" }),
    ev(s + 1, 14, 15, "Client review", { kind: "event", subtitle: "Zoom" }),
    ev(s + 1, 15.5, 17, "Review Q4 research notes", { color: "research", label: "Research" }),
    // Tuesday
    ev(s + 2, 8.5, 10, "Wireframe pricing page", { color: "web", done: true, status: "Done" }),
    ev(s + 2, 10.5, 11.5, "Design crit", { kind: "event", subtitle: "Studio room" }),
    ev(s + 2, 13, 15.5, "Write launch email copy", { color: "web" }),
    // Wednesday (today in captures)
    ev(s + 3, 9, 9.5, "Standup", { kind: "eventOccurrence", subtitle: "Recurring · weekdays" }),
    ev(s + 3, 9.5, 11.5, "Research synthesis", { color: "research", label: "Research" }),
    ev(s + 3, 10, 11, "Hiring sync", { kind: "event" }),
    ev(s + 3, 12.5, 13.5, "Lunch with Sam", { color: "personal", kind: "event", label: "Personal" }),
    ev(s + 3, 14, 14, "Send invoice #1042", { color: "personal", label: "Personal", reminder: true, status: "Todo" }),
    ev(s + 3, 14.5, 16.5, "Build hero animation", { color: "web" }),
    // Thursday
    ev(s + 4, 9, 9.5, "Standup", { kind: "eventOccurrence", subtitle: "Recurring · weekdays" }),
    ev(s + 4, 9.5, 11.5, "Draft onboarding flow", { color: "web" }),
    ev(s + 4, 13, 14, "Dentist", { color: "personal", kind: "event", label: "Personal", subtitle: "Dr. Alvarez" }),
    ev(s + 4, 15, 16, "Call the landlord", { color: "personal", label: "Personal", status: "Todo" }),
    // Friday
    ev(s + 5, 9, 10.5, "QA staging build", { color: "web" }),
    ev(s + 5, 11, 12, "Retro", { kind: "event" }),
    ev(s + 5, 16, 17, "Week review", { kind: "taskOccurrence", color: "research", label: "Research", status: "Todo" }),
  ];
};

const noop = () => {};

export const ThreeDays = () => (
  <div className="flex flex-col p-4" style={{ width: 640, height: 600 }}>
    <TimeGrid days={[day(0), day(1), day(2)]} events={weekEvents()} onSelectEvent={noop} onSelectSlot={noop} onMoveBlock={noop} />
  </div>
);

export const OverlappingLanes = () => {
  seq = 100;
  const events = [
    ev(0, 9, 11, "Research synthesis", { color: "research", label: "Research" }),
    ev(0, 9.5, 10.5, "Hiring sync", { kind: "event" }),
    ev(0, 10, 12, "Draft onboarding flow", { color: "web" }),
    ev(0, 11, 11, "Send invoice #1042", { color: "personal", label: "Personal", reminder: true }),
    ev(0, 13, 13.5, "Quick call with Priya", { kind: "event" }),
  ];
  return (
    <div className="flex flex-col p-4" style={{ width: 520, height: 520 }}>
      <TimeGrid days={[day(0)]} events={events} onSelectEvent={noop} onSelectSlot={noop} onMoveBlock={noop} />
    </div>
  );
};
