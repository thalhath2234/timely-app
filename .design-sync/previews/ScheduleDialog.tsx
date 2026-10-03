import { ScheduleDialog } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

// Opened by clicking an empty calendar slot; the page passes its task list.
// Cells load the sample workspace's tasks. The dialog is position:fixed (not
// portaled); the transformed frame is its containing block.
const Frame = ({ children, root }: { children: React.ReactNode; root?: React.Ref<HTMLDivElement> }) => (
  <div ref={root} className="bg-muted" style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", transform: "translateZ(0)" }}>{children}</div>
);

function slotAt(days: number, h: number, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Open({ mode, durationMinutes, noTasks, after }: {
  mode?: "task" | "event";
  durationMinutes?: number;
  noTasks?: boolean;
  after?: (root: HTMLElement) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<unknown[] | null>(noTasks ? [] : null);
  useEffect(() => {
    if (noTasks) return;
    fetch("/api-proxy/tasks").then((r) => r.json()).then(setTasks);
  }, [noTasks]);
  useEffect(() => {
    if (!tasks || !after) return;
    const timer = window.setTimeout(() => root.current && after(root.current), 30);
    return () => window.clearTimeout(timer);
  }, [tasks, after]);
  const [slot] = useState(() => ({ at: slotAt(1, 14, 0), durationMinutes, mode }));
  return (
    <Frame root={root}>
      {tasks ? <ScheduleDialog slot={slot} tasks={tasks as never} onClose={() => undefined} /> : null}
    </Frame>
  );
}

const pickTask = (name: string) => (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] li button')]
    .find((b) => b.textContent?.includes(name))
    ?.click();

export const ScheduleTask = () => <Open />;

export const TaskPicked = () => (
  <Open durationMinutes={60} after={pickTask("Accessibility pass on onboarding color contrast")} />
);

export const NewEvent = () => (
  <Open
    mode="event"
    durationMinutes={60}
    after={(root) => typeInto(root.querySelector<HTMLInputElement>('input[placeholder^="Dentist"]'), "Dentist cleaning")}
  />
);

export const NothingUnscheduled = () => <Open noTasks />;
