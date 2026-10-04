import { ProposalPanel } from "@timely/ui";

const slot = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const steps = [
  {
    tool: "create_project",
    summary: "Create project “Website relaunch”",
    arguments: { name: "Website relaunch", workspace: "Studio" },
  },
  {
    tool: "create_task",
    summary: "Add task “Draft onboarding flow” (2h)",
    arguments: { title: "Draft onboarding flow", project: "$0.project", duration: 120 },
  },
  {
    tool: "schedule_task",
    summary: "Schedule “Draft onboarding flow” Thursday 9:30–11:30",
    arguments: { task: "$1.task", start: slot(1, 9, 30), end: slot(1, 11, 30) },
  },
];

const chat = (status: string, phase: string, statuses: string[], extra: Record<string, unknown> = {}) => ({
  id: "c_week",
  title: "Plan the website relaunch week",
  status,
  phase,
  webSearch: false,
  context: [],
  messages: [],
  revision: 4,
  unread: false,
  error: "",
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  plan: steps.map((s, i) => ({ ...s, status: statuses[i] })),
  ...extra,
});

const done = (i: number) =>
  [
    { project: { id: "p_web", name: "Website relaunch" } },
    { task: { id: "t_onb", title: "Draft onboarding flow" } },
    { event: { id: "b_1", title: "Draft onboarding flow" } },
  ][i];

const withResults = (c: ReturnType<typeof chat>) => ({
  ...c,
  plan: c.plan.map((s, i) => (s.status === "done" ? { ...s, result: done(i) } : s)),
});

const noop = () => {};

export const ReadyForReview = () => (
  <div className="p-4" style={{ width: 640 }}>
    <ProposalPanel
      chat={chat("approval", "", ["pending", "pending", "pending"])}
      pending={false}
      receiptDirty={false}
      act={noop}
    />
  </div>
);

export const Applying = () => (
  <div className="p-4" style={{ width: 640 }}>
    <ProposalPanel
      chat={withResults(chat("running", "apply", ["done", "pending", "pending"]))}
      pending={false}
      receiptDirty={false}
      act={noop}
    />
  </div>
);

export const Applied = () => (
  <div className="p-4" style={{ width: 640 }}>
    <ProposalPanel
      chat={withResults(chat("idle", "", ["done", "done", "done"]))}
      pending={false}
      receiptDirty={false}
      act={noop}
    />
  </div>
);

export const Failed = () => {
  const c = withResults(chat("failed", "apply", ["done", "done", "failed"]));
  c.plan[2] = {
    ...c.plan[2],
    error: "Thursday 9:30–11:30 overlaps “Client review”. Pick another slot or move the review.",
  };
  return (
    <div className="p-4" style={{ width: 640 }}>
      <ProposalPanel chat={c} pending={false} receiptDirty={false} act={noop} />
    </div>
  );
};

export const Stopped = () => (
  <div className="p-4" style={{ width: 640 }}>
    <ProposalPanel
      chat={withResults(chat("stopped", "apply", ["done", "pending", "pending"]))}
      pending={false}
      receiptDirty={false}
      act={noop}
    />
  </div>
);

export const ReviewWithRemoval = () => (
  <div className="p-4" style={{ width: 640 }}>
    <ProposalPanel
      chat={{
        ...chat("approval", "", []),
        plan: [
          { ...steps[1], status: "pending" },
          {
            tool: "delete_task",
            summary: "Delete task “Old landing page copy”",
            arguments: { task: "t_old" },
            before: { title: "Old landing page copy", project: "Website relaunch", status: "Backlog" },
            status: "pending",
          },
        ],
      }}
      pending={false}
      receiptDirty={false}
      act={noop}
    />
  </div>
);
