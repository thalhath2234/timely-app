import { KanbanView, sampleApi } from "@timely/ui";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

function Board({ groupField, projectId }: { groupField: string; projectId?: string }) {
  const tasks = get<any[]>("GET /tasks");
  // Stage columns read their names from row.project.stages; GET /projects carries them.
  const projects = get<any[]>("GET /projects");
  const rows = (projectId ? tasks.filter((task) => task.projectId === projectId) : tasks).map((task) => ({
    ...task,
    project: task.project && { ...task.project, stages: projects.find((p) => p.id === task.projectId)?.stages },
  }));
  return (
    <div className="overflow-auto bg-background" style={{ width: 1180, height: 620 }}>
      <KanbanView
        rows={rows}
        dataMode="task"
        onSelectRow={() => {}}
        workspaces={get("GET /workspaces")}
        selectedWorkspaceIds={[]}
        selectedStatusIds={[]}
        selectedPriorityLevels={[]}
        groupField={groupField as any}
      />
    </div>
  );
}

export const ByStatus = () => <Board groupField="status" />;

export const OnboardingByStage = () => <Board groupField="stage" projectId="prj_onboarding" />;

export const ByPriority = () => <Board groupField="priority" />;
