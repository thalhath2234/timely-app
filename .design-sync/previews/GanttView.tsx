import { GanttView, sampleApi } from "@timely/ui";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

/** The tasks page synthesises one row per project in project mode. */
function projectRows() {
  const tasks = get<any[]>("GET /tasks");
  return get<any[]>("GET /projects").map((project) => {
    const first = tasks.find((task) => task.projectId === project.id) ?? tasks[0];
    return {
      ...first,
      id: `project-${project.id}`,
      name: project.title,
      description: project.description ?? "",
      deadline: project.deadline ?? null,
      startDate: project.startDate ?? null,
      completedAt: project.completedAt ?? null,
      projectId: project.id,
      project,
      blocks: [],
    };
  });
}

const Frame = ({ children, height = 620 }: { children: React.ReactNode; height?: number }) => (
  <div className="bg-background" style={{ width: 1180, height }}>
    {children}
  </div>
);

export const TaskTimeline = () => (
  <Frame>
    <GanttView rows={get("GET /tasks")} dataMode="task" onSelectRow={() => {}} />
  </Frame>
);

export const OnboardingProject = () => (
  <Frame height={520}>
    <GanttView
      rows={get<any[]>("GET /tasks").filter((task) => task.projectId === "prj_onboarding")}
      dataMode="task"
      onSelectRow={() => {}}
    />
  </Frame>
);

export const ProjectTimelines = () => (
  <Frame height={300}>
    <GanttView rows={projectRows()} dataMode="project" onSelectRow={() => {}} />
  </Frame>
);

export const Empty = () => (
  <Frame height={80}>
    <GanttView rows={[]} dataMode="task" onSelectRow={() => {}} />
  </Frame>
);
