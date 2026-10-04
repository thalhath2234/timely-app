import { TasksTable, TimelyProvider, sampleApi } from "@timely/ui";
import { useState } from "react";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

const FILTERS = {
  workspaceIds: [], statusIds: [], projectIds: [], priorityLevels: [], labelIds: [], stageIds: [],
  showCompleted: true, onlyOverdue: false, onlyScheduled: false, onlyRecurring: false, onlyDated: false,
  showReminders: false,
};

function stageMaps() {
  const names: Record<string, string> = {};
  const colors: Record<string, string> = {};
  for (const project of get<any[]>("GET /projects")) {
    for (const stage of project.stages ?? []) {
      names[stage.id] = stage.name;
      if (stage.color) colors[stage.id] = stage.color;
    }
  }
  return { names, colors };
}

function Table({
  groupFields = ["workspace", "project", "stage"],
  dataMode = "task",
  sortBy = "deadline",
  selected = [],
  filters = {},
  height = 640,
}: {
  groupFields?: string[];
  dataMode?: "task" | "project";
  sortBy?: string;
  selected?: string[];
  filters?: Record<string, unknown>;
  height?: number;
}) {
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(selected);
  const { names, colors } = stageMaps();
  return (
    <div className="overflow-auto bg-background" style={{ width: 1180, height }}>
      <TasksTable
        config={get("GET /config")}
        dataMode={dataMode}
        groupFields={groupFields as any}
        groupSortDirection="asc"
        groupValueOrders={{}}
        selectedWorkspaceIds={[]}
        sortBy={sortBy as any}
        sortDirection="asc"
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        onSelectRow={() => {}}
        filters={{ ...FILTERS, ...filters } as any}
        stageNames={names}
        stageColors={colors}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
      />
    </div>
  );
}

export const GroupedByProject = () => <Table />;

export const ByPrioritySelected = () => (
  <Table
    groupFields={["priority"]}
    sortBy="priority"
    selected={["tsk_welcome_wireframes", "tsk_empty_state_copy", "tsk_invite_screen"]}
    filters={{ showCompleted: false }}
  />
);

export const ProjectRows = () => <Table dataMode="project" groupFields={["workspace"]} sortBy="startDate" height={240} />;

export const Empty = () => (
  <TimelyProvider animations={false} seed={[[["tasks"], []]]}>
    <Table height={120} />
  </TimelyProvider>
);
