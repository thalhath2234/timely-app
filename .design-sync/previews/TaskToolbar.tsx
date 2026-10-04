import { TaskToolbar } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const t = "2024-05-01T09:00:00Z";
const status = (id: string, name: string, color: string, workspaceId: string) => ({
  id, name, color, workspaceId, createdAt: t, updatedAt: t,
});
const WORKSPACES = [
  {
    id: "w1", name: "Studio", color: "#6E56CF", userId: "u1", createdAt: t, updatedAt: t, customFields: [],
    status: [
      status("s1", "Backlog", "#889096", "w1"),
      status("s2", "In progress", "#0090FF", "w1"),
      status("s3", "In review", "#FFB224", "w1"),
      status("s4", "Done", "#30A66D", "w1"),
    ],
  },
  {
    id: "w2", name: "Personal", color: "#12A594", userId: "u1", createdAt: t, updatedAt: t, customFields: [],
    status: [status("s5", "To do", "#889096", "w2"), status("s6", "Done", "#30A66D", "w2")],
  },
];
const CUSTOM_FIELDS = [
  { id: "cf1", name: "Effort", workspaceId: "w1", createdTime: t, updatedTime: t, type: "select" as const, options: { options: [] } },
];

type Props = {
  viewMode?: "list" | "kanban" | "gantt";
  groups?: string[];
  scope?: "global" | "project";
  statusIds?: string[];
  count?: number;
  reminders?: boolean;
};

function Toolbar({ viewMode = "list", groups = ["workspace", "project", "stage"], scope = "global", statusIds = [], count = 42, reminders = false }: Props) {
  const [mode, setMode] = useState(viewMode);
  const [groupFields, setGroupFields] = useState<any[]>(groups);
  const [groupSort, setGroupSort] = useState<"asc" | "desc">("asc");
  const [dataMode, setDataMode] = useState<any>("task");
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [selectedStatusIds, setSelectedStatusIds] = useState(statusIds);
  const [sortBy, setSortBy] = useState<any>("deadline");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showReminders, setShowReminders] = useState(reminders);
  return (
    <TaskToolbar
      viewMode={mode}
      setViewMode={setMode}
      groupFields={groupFields}
      setGroupFields={setGroupFields}
      groupSortDirection={groupSort}
      setGroupSortDirection={setGroupSort}
      dataMode={dataMode}
      setDataMode={setDataMode}
      groupValueOrders={orders}
      setGroupValueOrders={setOrders}
      groupOptionsByField={{
        workspace: ["Personal", "Studio"],
        project: ["Q4 research sprint", "Website relaunch"],
        stage: ["Discovery", "Design", "Build"],
        status: ["Backlog", "In progress", "In review", "Done"],
      }}
      workspaces={WORKSPACES as any}
      selectedWorkspaceIds={workspaceIds}
      setSelectedWorkspaceIds={setWorkspaceIds}
      selectedStatusIds={selectedStatusIds}
      setSelectedStatusIds={setSelectedStatusIds}
      dataCount={count}
      sortBy={sortBy}
      setSortBy={setSortBy}
      sortDirection={sortDir}
      setSortDirection={setSortDir}
      customFields={CUSTOM_FIELDS as any}
      showReminders={showReminders}
      setShowReminders={setShowReminders}
      scope={scope}
    />
  );
}

export const AllTasksList = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Toolbar />
  </div>
);

export const ProjectKanban = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Toolbar viewMode="kanban" scope="project" groups={["status"]} count={14} />
  </div>
);

export const FilteredReminders = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Toolbar viewMode="gantt" groups={["priority"]} statusIds={["s2"]} count={6} reminders />
  </div>
);

export const GroupPanelOpen = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const button = Array.from(ref.current?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.startsWith("Group by"),
    );
    button?.click();
  }, []);
  return (
    <div ref={ref} className="bg-background" style={{ width: "100%", height: 360 }}>
      <Toolbar />
    </div>
  );
};
