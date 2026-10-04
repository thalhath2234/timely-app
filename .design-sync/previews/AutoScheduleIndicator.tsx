import { AutoScheduleDialog, AutoScheduleIndicator, TimelyProvider } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

// The indicator reads the schedule-activity store, which only the Auto-schedule
// dialog's "Apply schedule" writes. Each cell runs that real flow: open the
// dialog, apply, close it - leaving the floating status as it shows in the app.
// The indicator is position:fixed bottom-right; the transformed frame is its
// containing block. The mock route table is page-global, so every cell
// installs the SAME routes; the apply handler picks its outcome from the run's
// taskIds (each cell scopes its run to a different task).

function at(days: number, h: number, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
const proposal = (taskId: string, taskName: string, days: number, h: number, minutes: number) => ({
  taskId,
  taskName,
  blocks: [{ start: at(days, h), end: new Date(Date.parse(at(days, h)) + minutes * 60_000).toISOString(), chunkIndex: 0 }],
  endsAt: at(days, h + 1),
  pastDeadline: false,
});
const PLAN = {
  from: at(0, 12),
  to: at(14, 12),
  timezone: "America/Los_Angeles",
  freeMinutes: 3600,
  plannedMinutes: 330,
  applied: false,
  skipped: [],
  proposals: [
    proposal("tsk_welcome_wireframes", "Wireframe the 3-step welcome flow", 0, 13, 30),
    proposal("tsk_contrast_pass", "Accessibility pass on onboarding color contrast", 1, 9, 90),
    proposal("tsk_handoff_notes", "Prepare handoff notes and redlines for engineering", 1, 14, 120),
    proposal("tsk_button_audit", "Audit button variants across product surfaces", 3, 9, 60),
  ],
};

const RUNNING = "tsk_handoff_notes";
const FAILED = "tsk_button_audit";

const API = {
  "POST /schedule/preview": PLAN,
  "POST /schedule/apply": (req: { body: unknown }) => {
    const ids = (req.body as { taskIds?: string[] } | undefined)?.taskIds ?? [];
    if (ids.includes(RUNNING)) return new Promise(() => {});
    if (ids.includes(FAILED)) {
      return new Response(JSON.stringify({ message: "Couldn’t reach Google Calendar. Nothing was moved." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return { ...PLAN, applied: true, canUndo: true };
  },
};

function Run({ taskIds }: { taskIds?: string[] }) {
  const [open, setOpen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (label: string) =>
      [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === label)?.click();
    const timers = [
      window.setTimeout(() => click("Apply schedule"), 120),
      window.setTimeout(() => setOpen(false), 260),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return (
    <TimelyProvider animations={false} api={API}>
      <div
        ref={root}
        className="rounded-xl border border-border bg-muted"
        style={{ width: 520, height: 180, transform: "translateZ(0)" }}
      >
        <AutoScheduleDialog open={open} onClose={() => setOpen(false)} taskIds={taskIds} />
        <AutoScheduleIndicator />
      </div>
    </TimelyProvider>
  );
}

export const Running = () => <Run taskIds={[RUNNING]} />;

export const Placed = () => <Run />;

export const Failed = () => <Run taskIds={[FAILED]} />;
