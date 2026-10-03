import { AutoScheduleDialog, TimelyProvider } from "@timely/ui";
import { useEffect, useRef } from "react";

// The dialog is position:fixed (not portaled): the transformed frame is its
// containing block. The sample API has no schedule engine, so the card adds
// POST /schedule/preview + /apply. The mock route table is page-global, so
// every cell installs the SAME routes and the handler picks the plan from the
// request's taskIds (the only per-run input a cell controls).
const Frame = ({ children, root }: { children: React.ReactNode; root?: React.Ref<HTMLDivElement> }) => (
  <div ref={root} style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", transform: "translateZ(0)" }}>{children}</div>
);

/** ISO instant `days` from today at local hh:mm. */
function at(days: number, h: number, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
const ymd = (days: number) => at(days, 12).slice(0, 10);

function block(days: number, h: number, m: number, minutes: number, chunkIndex = 0) {
  const start = at(days, h, m);
  return { start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), chunkIndex };
}

const capacity = [
  { date: ymd(0), availableMinutes: 240, scheduledMinutes: 150, plannedMinutes: 210, overCapacity: false, atRisk: false },
  { date: ymd(1), availableMinutes: 360, scheduledMinutes: 135, plannedMinutes: 300, overCapacity: false, atRisk: true },
  { date: ymd(2), availableMinutes: 300, scheduledMinutes: 60, plannedMinutes: 330, overCapacity: true, atRisk: true },
  { date: ymd(3), availableMinutes: 420, scheduledMinutes: 0, plannedMinutes: 120, overCapacity: false, atRisk: false },
];

const BASE = {
  from: at(0, 12),
  to: at(14, 12),
  timezone: "America/Los_Angeles",
  freeMinutes: 3720,
  applied: false,
};

const PLAN = {
  ...BASE,
  plannedMinutes: 510,
  proposals: [
    {
      taskId: "tsk_welcome_wireframes",
      taskName: "Wireframe the 3-step welcome flow",
      blocks: [block(0, 13, 0, 105)],
      endsAt: at(0, 14, 45),
      deadline: ymd(0),
      pastDeadline: false,
      reason: "Due today · High priority",
      requiredMinutes: 105,
      placedMinutes: 105,
    },
    {
      taskId: "tsk_contrast_pass",
      taskName: "Accessibility pass on onboarding color contrast",
      blocks: [block(1, 9, 30, 90)],
      endsAt: at(1, 11),
      deadline: ymd(3),
      pastDeadline: false,
      reason: "Deadline in 3 days",
    },
    {
      taskId: "tsk_handoff_notes",
      taskName: "Prepare handoff notes and redlines for engineering",
      blocks: [block(1, 14, 0, 60), block(2, 10, 0, 60, 1)],
      endsAt: at(2, 11),
      pastDeadline: false,
      reason: "Split around the critique and 1:1",
    },
    {
      taskId: "tsk_button_audit",
      taskName: "Audit button variants across product surfaces",
      blocks: [block(3, 9, 0, 60)],
      endsAt: at(3, 10),
      pastDeadline: false,
    },
  ],
  changes: [
    { action: "add", taskId: "tsk_contrast_pass", taskName: "Accessibility pass on onboarding color contrast", message: "New block Thu 9:30" },
    { action: "move", taskId: "tsk_handoff_notes", taskName: "Prepare handoff notes and redlines for engineering", message: "Moved from Mon to Thu" },
  ],
  capacity,
  skipped: [
    { taskId: "tsk_spacing_tokens", taskName: "Define spacing and radius tokens", reason: "locked" },
    { taskId: "tsk_renew_passport", taskName: "Renew passport", reason: "workspace_excluded" },
    { taskId: "tsk_focus_ring", taskName: "Fix focus ring inconsistencies in form inputs", reason: "blocked" },
  ],
};

const AT_RISK = {
  ...BASE,
  plannedMinutes: 600,
  freeMinutes: 420,
  proposals: [
    {
      taskId: "tsk_invite_screen",
      taskName: "Design the workspace-invite screen in high fidelity",
      blocks: [block(0, 13, 0, 120), block(1, 9, 0, 60, 1)],
      endsAt: at(1, 10),
      deadline: ymd(1),
      pastDeadline: false,
      partial: true,
      requiredMinutes: 240,
      placedMinutes: 180,
      shortfallMinutes: 60,
      reason: "Only 3h free before the deadline",
    },
    {
      taskId: "tsk_dark_ramp",
      taskName: "Draft the dark-mode color ramp proposal",
      blocks: [block(2, 14, 0, 150)],
      endsAt: at(2, 16, 30),
      deadline: ymd(1),
      pastDeadline: true,
      reason: "No room before Thursday",
    },
  ],
  risks: [
    { kind: "deadline", taskId: "tsk_dark_ramp", taskName: "Draft the dark-mode color ramp proposal", message: "lands a day after its deadline" },
    { kind: "capacity", message: "Friday is booked 1h 30m over your working hours" },
  ],
  capacity,
  skipped: [
    { taskId: "tsk_handoff_notes", taskName: "Prepare handoff notes and redlines for engineering", reason: "contiguous_no_fit" },
  ],
};

const EMPTY = { ...BASE, freeMinutes: 0, plannedMinutes: 0, proposals: [], skipped: [
  { taskId: "tsk_welcome_wireframes", taskName: "Wireframe the 3-step welcome flow", reason: "no_capacity" },
  { taskId: "tsk_pick_case_studies", taskName: "Pick three case studies to feature", reason: "no_duration" },
] };

const SCOPED = {
  ...BASE,
  plannedMinutes: 90,
  proposals: [PLAN.proposals[1]],
  skipped: [],
};

const AT_RISK_IDS = ["tsk_invite_screen", "tsk_dark_ramp"];
const EMPTY_IDS = ["tsk_pick_case_studies", "tsk_welcome_wireframes"];

function planFor(body: unknown) {
  const ids = ((body as { taskIds?: string[] } | undefined)?.taskIds ?? []).join(",");
  if (ids === AT_RISK_IDS.join(",")) return AT_RISK;
  if (ids === EMPTY_IDS.join(",")) return EMPTY;
  if (ids === "tsk_contrast_pass") return SCOPED;
  return PLAN;
}

const API = {
  "POST /schedule/preview": (req: { body: unknown }) => planFor(req.body),
  "POST /schedule/apply": (req: { body: unknown }) => ({ ...planFor(req.body), applied: true, canUndo: true }),
};

function Dialog({ taskIds, settings, applyOnMount }: {
  taskIds?: string[];
  settings?: boolean;
  applyOnMount?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!applyOnMount) return;
    const timer = window.setTimeout(() => {
      [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === "Apply schedule")?.click();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [applyOnMount]);
  return (
    <TimelyProvider animations={false} api={API}>
      <Frame root={root}>
        <AutoScheduleDialog
          open
          onClose={() => undefined}
          onOpenSettings={settings ? () => undefined : undefined}
          taskIds={taskIds}
        />
      </Frame>
    </TimelyProvider>
  );
}

export const Preview = () => <Dialog />;

export const AtRisk = () => <Dialog taskIds={AT_RISK_IDS} />;

export const SingleTask = () => <Dialog taskIds={["tsk_contrast_pass"]} />;

export const Applied = () => <Dialog applyOnMount />;

export const NoWorkingHours = () => <Dialog taskIds={EMPTY_IDS} settings />;
