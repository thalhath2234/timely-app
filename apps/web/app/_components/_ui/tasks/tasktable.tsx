import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Config,
  Task,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortBy,
  TaskListSortDirection,
} from "@/app/_types/types";
import { useTasks } from "@/app/utils/hooks/tasks";

type TasksTableProps = {
  config: Config;
  dataMode: TaskListDataMode;
  groupFields: TaskListGroupField[];
  groupSortDirection: TaskListGroupSortDirection;
  groupValueOrders: Record<string, string[]>;
  selectedWorkspaceIds: string[];
  sortBy: TaskListSortBy;
  sortDirection: TaskListSortDirection;
};

type GroupNode = {
  key: string;
  label: string;
  depth: number;
  count: number;
  children: GroupNode[];
  rows: Task[];
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function getPriorityWeight(priority?: string | null): number {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
      return 5;
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function getCustomFieldDisplayValue(task: Task, fieldId: string): string {
  const value = task.customFieldValues?.find((entry) => entry.customFieldId === fieldId);
  if (!value) return "-";

  if (value.optionValue?.length) {
    return value.optionValue.map((option) => option.value).join(", ");
  }

  if (value.stringValue) return value.stringValue;
  if (typeof value.numberValue === "number") return String(value.numberValue);
  if (value.dateValue) return formatDate(value.dateValue);
  if (typeof value.boolValue === "boolean") return value.boolValue ? "Yes" : "No";

  return "-";
}

function getGroupLabel(task: Task, groupBy: TaskListGroupField): string {
  if (groupBy === "workspace") return task.workspace?.name || "No workspace";
  if (groupBy === "project") return task.project?.title || task.project?.name || "No project";
  if (groupBy === "status") return task.status?.name || "No status";
  if (groupBy === "priority") return task.priorityLevel || "No priority";
  if (groupBy === "stage") return task.stageId || task.stageid || "No stage";
  if (groupBy.startsWith("cf:")) return getCustomFieldDisplayValue(task, groupBy.slice(3));
  return "No group";
}

function compareGroupLabel(
  a: string,
  b: string,
  direction: TaskListGroupSortDirection,
  customOrder?: string[]
): number {
  if (customOrder && customOrder.length > 0) {
    const aIndex = customOrder.indexOf(a);
    const bIndex = customOrder.indexOf(b);

    if (aIndex >= 0 && bIndex >= 0) {
      return aIndex - bIndex;
    }

    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
  }

  const compared = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return direction === "asc" ? compared : compared * -1;
}

function buildNestedGroups(
  rows: Task[],
  groupFields: TaskListGroupField[],
  groupSortDirection: TaskListGroupSortDirection,
  groupValueOrders: Record<string, string[]>,
  depth = 0,
  parentKey = ""
): GroupNode[] {
  if (depth >= groupFields.length) return [];

  const field = groupFields[depth];
  const grouped = new Map<string, Task[]>();

  rows.forEach((task) => {
    const label = getGroupLabel(task, field);
    const existing = grouped.get(label) ?? [];
    existing.push(task);
    grouped.set(label, existing);
  });

  return Array.from(grouped.entries())
    .sort(([aLabel], [bLabel]) =>
      compareGroupLabel(aLabel, bLabel, groupSortDirection, groupValueOrders[field])
    )
    .map(([label, groupRows]) => {
      const nodeKey = parentKey ? `${parentKey}::${label}` : label;
      const children = buildNestedGroups(
        groupRows,
        groupFields,
        groupSortDirection,
        groupValueOrders,
        depth + 1,
        nodeKey
      );

      return {
        key: nodeKey,
        label,
        depth,
        count: groupRows.length,
        children,
        rows: groupRows,
      };
    });
}

function compareTasks(a: Task, b: Task, sortBy: TaskListSortBy): number {
  switch (sortBy) {
    case "name":
      return (a.name || "").localeCompare(b.name || "");
    case "deadline":
      return (new Date(a.deadline || "").getTime() || 0) - (new Date(b.deadline || "").getTime() || 0);
    case "startDate":
      return (new Date(a.startDate || "").getTime() || 0) - (new Date(b.startDate || "").getTime() || 0);
    case "createdAt":
      return (new Date(a.createdAt || "").getTime() || 0) - (new Date(b.createdAt || "").getTime() || 0);
    case "priority":
      return getPriorityWeight(a.priorityLevel) - getPriorityWeight(b.priorityLevel);
    case "status":
      return (a.status?.name || "").localeCompare(b.status?.name || "");
    case "project":
      return (a.project?.title || a.project?.name || "").localeCompare(
        b.project?.title || b.project?.name || ""
      );
    default:
      return 0;
  }
}

function getBlockedByDisplayValue(task: Task): string {
  const blockedBy = (task as Task & { blockedBy?: { id: string; name?: string } | null }).blockedBy;
  if (blockedBy?.name) return blockedBy.name;
  if (blockedBy?.id) return blockedBy.id;
  return task.blockedById || task.blockedByid || "-";
}

function buildProjectRows(tasks: Task[]): Task[] {
  const projects = new Map<string, Task[]>();

  tasks.forEach((task) => {
    const projectId = task.project?.id || task.projectId || task.projectid;
    if (!projectId) return;
    const existing = projects.get(projectId) ?? [];
    existing.push(task);
    projects.set(projectId, existing);
  });

  return Array.from(projects.entries()).map(([projectId, projectTasks]) => {
    const first = projectTasks[0];
    const project = first.project;
    const totalDuration = projectTasks.reduce((sum, item) => sum + (item.duration || 0), 0);

    return {
      id: `project-${projectId}`,
      name: project?.name || project?.title || "Untitled project",
      description: project?.description || "",
      timeChunks: 0,
      duration: totalDuration,
      deadline: project?.deadline || null,
      startDate: project?.startDate || null,
      scheduledOn: null,
      completedAt: project?.completedAt || null,
      createdAt: project?.createdAt || first.createdAt,
      updatedAt: project?.updatedAt || first.updatedAt,
      userId: first.userId,
      projectId,
      statusId: project?.statusId || null,
      priorityLevel: project?.priorityLevel || first.priorityLevel || null,
      workspaceId: project?.workspaceId || first.workspaceId || first.workspaceid || null,
      scheduleId: null,
      stageId: null,
      blockedById: null,
      project,
      workspace: first.workspace,
      status: first.status,
      customFieldValues: [],
      labelIds: [],
      labels: [],
    };
  });
}

export default function TasksTable({
  config,
  dataMode,
  groupFields,
  groupSortDirection,
  groupValueOrders,
  selectedWorkspaceIds,
  sortBy,
  sortDirection,
}: TasksTableProps) {
  const { data: tasks, isLoading, status } = useTasks();
  const typedTasks = (tasks ?? []) as Task[];
  const customFields = config.customFields ?? [];
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const dataRows = useMemo(
    () => (dataMode === "project" ? buildProjectRows(typedTasks) : typedTasks),
    [dataMode, typedTasks]
  );

  const filteredRows = useMemo(() => {
    if (selectedWorkspaceIds.length === 0) return dataRows;

    return dataRows.filter((row) => {
      const workspaceId = row.workspace?.id || row.workspaceId || row.workspaceid;
      if (!workspaceId) return false;
      return selectedWorkspaceIds.includes(workspaceId);
    });
  }, [dataRows, selectedWorkspaceIds]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const compared = compareTasks(a, b, sortBy);
      return sortDirection === "asc" ? compared : compared * -1;
    });

    return sorted;
  }, [filteredRows, sortBy, sortDirection]);

  const nestedGroups = useMemo(
    () => buildNestedGroups(sortedTasks, groupFields, groupSortDirection, groupValueOrders),
    [sortedTasks, groupFields, groupSortDirection, groupValueOrders]
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const headerOffset = 36;

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (status === "error") {
    return <div>Something went wrong</div>;
  }

  if (!sortedTasks.length) {
    return <div className="p-4 text-sm text-white/70">No tasks yet.</div>;
  }

  const headerCellClass = "px-3 py-2 font-medium whitespace-nowrap bg-[#13212f] align-middle";
  const textCell = "px-3 py-2 text-white/85 whitespace-nowrap align-middle";
  const primaryTextCell = "px-3 py-2 font-medium text-white/95 whitespace-nowrap align-middle";
  const descriptionCell = "px-3 py-2 text-white/80 max-w-80 truncate align-middle";
  const numericCell = "px-3 py-2 text-white/80 text-right tabular-nums whitespace-nowrap align-middle";
  const dateCell = "px-3 py-2 text-white/80 text-center tabular-nums whitespace-nowrap align-middle";

  const renderTaskCells = (task: Task, indentDepth = 0) => (
    <>
      <td
        className={primaryTextCell}
        style={{
          paddingLeft: `${12 + indentDepth * 16}px`,
        }}
      >
        {task.name}
      </td>
      <td className={descriptionCell}>{task.description || "-"}</td>
      <td className={numericCell}>{typeof task.duration === "number" ? `${task.duration}m` : "-"}</td>
      <td className={dateCell}>{formatDate(task.startDate)}</td>
      <td className={dateCell}>{formatDate(task.deadline)}</td>
      <td className={dateCell}>{formatDate(task.scheduledOn)}</td>
      <td className={dateCell}>{formatDate(task.completedAt)}</td>
      <td className={dateCell}>{formatDate(task.createdAt)}</td>
      <td className={dateCell}>{formatDate(task.updatedAt)}</td>
      <td className={textCell}>{task.project?.name || task.project?.title || "-"}</td>
      <td className={textCell}>{task.workspace?.name || "-"}</td>
      <td className={textCell}>{getBlockedByDisplayValue(task)}</td>
      <td className="px-3 py-2 text-white/80 text-center whitespace-nowrap align-middle">{task.priorityLevel || "-"}</td>
      <td className="px-3 py-2 text-white/80 text-center tabular-nums whitespace-nowrap align-middle">{task.stageId || task.stageid || "-"}</td>
      <td className="px-3 py-2 text-white/80 text-center tabular-nums whitespace-nowrap align-middle">{task.scheduleId || task.scheduleid || "-"}</td>

      <td className="px-3 py-2 align-middle">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs"
          style={{
            backgroundColor: `${task.status?.color || "#889096"}33`,
            color: task.status?.color || "#d1d5db",
          }}
        >
          {task.status?.name || "-"}
        </span>
      </td>

      <td className="px-3 py-2 align-middle">
        <div className="flex flex-wrap gap-1">
          {(task.labels ?? []).length === 0 && <span className="text-white/50">-</span>}

          {(task.labels ?? []).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs"
              style={{
                backgroundColor: `${label.color || "#889096"}33`,
                color: label.color || "#d1d5db",
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      </td>

      {customFields.map((field) => (
        <td key={`${task.id}-${field.id}`} className={textCell}>
          {getCustomFieldDisplayValue(task, field.id)}
        </td>
      ))}
    </>
  );

  return (
    <div className="w-full h-full overflow-x-auto overflow-y-auto relative isolate">
      <table className="w-max min-w-full text-sm border-collapse">
        <colgroup>
          <col className="w-64" />
          <col className="w-80" />
          <col className="w-24" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-44" />
          <col className="w-48" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-32" />
          <col className="w-36" />
          {customFields.map((field) => (
            <col key={`col-${field.id}`} className="w-44" />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-30">
          <tr className="text-left border-b border-white/10 bg-[#13212f]">
            <th className={headerCellClass}>{dataMode === "project" ? "Project" : "Task"}</th>
            <th className={headerCellClass}>Description</th>
            <th className={`${headerCellClass} text-right`}>Duration</th>
            <th className={`${headerCellClass} text-center`}>Start Date</th>
            <th className={`${headerCellClass} text-center`}>Deadline</th>
            <th className={`${headerCellClass} text-center`}>Scheduled On</th>
            <th className={`${headerCellClass} text-center`}>Completed At</th>
            <th className={`${headerCellClass} text-center`}>Created At</th>
            <th className={`${headerCellClass} text-center`}>Updated At</th>
            <th className={headerCellClass}>Project</th>
            <th className={headerCellClass}>Workspace</th>
            <th className={headerCellClass}>Blocked By</th>
            <th className={`${headerCellClass} text-center`}>Priority</th>
            <th className={`${headerCellClass} text-center`}>Stage ID</th>
            <th className={`${headerCellClass} text-center`}>Schedule ID</th>
            <th className={headerCellClass}>Status</th>
            <th className={headerCellClass}>Labels</th>
            {customFields.map((field) => (
              <th key={field.id} className={headerCellClass}>
                {field.name}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {groupFields.length === 0 &&
            sortedTasks.map((task) => (
              <tr key={task.id} className="border-b border-white/5 hover:bg-white/3">
                {renderTaskCells(task, 0)}
              </tr>
            ))}

          {groupFields.length > 0 &&
            nestedGroups.map((group) => {
              const renderNode = (node: GroupNode) => {
                const isCollapsed = !!collapsedGroups[node.key];
                const stickyTop = headerOffset + node.depth * 34;
                const zIndex = 28 - node.depth;

                return (
                  <Fragment key={node.key}>
                    <tr className="border-b border-white/10">
                      <td
                        colSpan={17 + customFields.length}
                        className="px-3 py-2 text-xs font-semibold text-white/85 sticky"
                        style={{
                          top: `${stickyTop}px`,
                          zIndex,
                          backgroundColor: "#182736",
                        }}
                      >
                        <button
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${node.depth * 14}px` }}
                          onClick={() => toggleGroup(node.key)}
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          <span>{node.label}</span>
                          <span className="text-white/60">({node.count})</span>
                        </button>
                      </td>
                    </tr>

                    {!isCollapsed &&
                      (node.children.length > 0
                        ? node.children.map((child) => renderNode(child))
                        : node.rows.map((task) => (
                            <tr key={task.id} className="border-b border-white/5 hover:bg-white/3">
                              {renderTaskCells(task, node.depth + 1)}
                            </tr>
                          ))) }
                  </Fragment>
                );
              };

              return renderNode(group);
            })}
        </tbody>
      </table>
    </div>
  );
}
