import { TaskListStatusBar } from "@timely/ui";

export const AllSynced = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <TaskListStatusBar shown={42} total={42} />
  </div>
);

export const Filtered = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <TaskListStatusBar shown={12} total={42} />
  </div>
);

export const WaitingToSync = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <TaskListStatusBar shown={7} total={7} synced={false} noun="reminders" />
  </div>
);

export const Projects = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <TaskListStatusBar shown={5} total={5} noun="projects" />
  </div>
);
