import { ChangeCards } from "@timely/ui";

const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const createProject = {
  tool: "create_project",
  summary: "Create project “Website relaunch”",
  arguments: { name: "Website relaunch", workspace: "Studio", deadline: at(14, 17) },
};
const createTask = {
  tool: "create_task",
  summary: "Add task “Draft onboarding flow” (2h)",
  arguments: { title: "Draft onboarding flow", project: "$0.project", duration: 120, priority: "high" },
};
const scheduleTask = {
  tool: "schedule_task",
  summary: "Schedule “Draft onboarding flow” Thursday 9:30–11:30",
  arguments: { task: "$1.task", start: at(1, 9, 30), end: at(1, 11, 30) },
};

export const Proposal = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      steps={[
        { ...createProject, status: "pending" },
        { ...createTask, status: "pending" },
        { ...scheduleTask, status: "pending" },
      ]}
    />
  </div>
);

export const Applying = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      activeIndex={1}
      steps={[
        { ...createProject, status: "done", result: { project: { id: "p_web", name: "Website relaunch" } } },
        { ...createTask, status: "pending" },
        { ...scheduleTask, status: "pending" },
      ]}
    />
  </div>
);

export const Applied = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      steps={[
        { ...createProject, status: "done", result: { project: { id: "p_web", name: "Website relaunch" } } },
        { ...createTask, status: "done", result: { task: { id: "t_onb", title: "Draft onboarding flow" } } },
        { ...scheduleTask, status: "done", result: { event: { id: "b_1", title: "Draft onboarding flow" } } },
      ]}
    />
  </div>
);

export const Removal = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      steps={[
        {
          tool: "delete_task",
          summary: "Delete task “Old landing page copy”",
          arguments: { task: "t_old" },
          before: {
            title: "Old landing page copy",
            project: "Website relaunch",
            status: "Backlog",
            duration: 45,
            updatedAt: at(-20, 10),
          },
          status: "pending",
        },
      ]}
    />
  </div>
);

export const Failed = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      steps={[
        { ...createTask, status: "done", result: { task: { id: "t_onb", title: "Draft onboarding flow" } } },
        {
          ...scheduleTask,
          status: "failed",
          error: "Thursday 9:30–11:30 overlaps “Client review”. Pick another slot or move the review.",
        },
      ]}
    />
  </div>
);

export const DiscardedArchive = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ChangeCards
      muted
      steps={[
        { ...createProject, status: "discarded" },
        { ...createTask, status: "discarded" },
      ]}
    />
  </div>
);
