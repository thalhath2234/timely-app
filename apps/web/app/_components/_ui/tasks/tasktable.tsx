import { Fragment, useMemo } from "react";
import {
  Config,
  Task,
  TaskListGroupBy,
  TaskListSortBy,
  TaskListSortDirection,
} from "@/app/_types/types";
import { useTasks } from "@/app/utils/hooks/tasks";

type TasksTableProps = {
  config: Config;
  groupBy: TaskListGroupBy;
  sortBy: TaskListSortBy;
  sortDirection: TaskListSortDirection;
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

function getGroupLabel(task: Task, groupBy: TaskListGroupBy): string {
  if (groupBy === "status") return task.status?.name || "No status";
  if (groupBy === "project") return task.project?.title || task.project?.name || "No project";
  if (groupBy === "priority") return task.priorityLevel || "No priority";
  if (groupBy.startsWith("cf:")) return getCustomFieldDisplayValue(task, groupBy.slice(3));
  return "All tasks";
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

export default function TasksTable({
  config,
  groupBy,
  sortBy,
  sortDirection,
}: TasksTableProps) {
  const { data: tasks, isLoading, status } = useTasks();
  const typedTasks = (tasks ?? []) as Task[];
  const customFields = config.customFields ?? [];

  const groupedTasks = useMemo(() => {
    const sorted = [...typedTasks].sort((a, b) => {
      const compared = compareTasks(a, b, sortBy);
      return sortDirection === "asc" ? compared : compared * -1;
    });

    if (groupBy === "none") {
      return [{ label: "All tasks", rows: sorted }];
    }

    const groups = new Map<string, Task[]>();
    sorted.forEach((task) => {
      const label = getGroupLabel(task, groupBy);
      const existing = groups.get(label) ?? [];
      existing.push(task);
      groups.set(label, existing);
    });

    return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
  }, [typedTasks, sortBy, sortDirection, groupBy]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (status === "error") {
    return <div>Something went wrong</div>;
  }

  if (!typedTasks.length) {
    return <div className="p-4 text-sm text-white/70">No tasks yet.</div>;
  }

  return (
    <div className="w-full h-full overflow-x-auto overflow-y-auto">
      <table className="w-max min-w-full text-sm">
        <thead className="bg-white/5 sticky top-0 z-10">
          <tr className="text-left border-b border-white/10">
            <th className="px-3 py-2 font-medium whitespace-nowrap">Task</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Description</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Duration</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Start Date</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Deadline</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Scheduled On</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Completed At</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Created At</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Updated At</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Project</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Workspace</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Blocked By</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Priority</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Stage ID</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Schedule ID</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Status</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Labels</th>
            {customFields.map((field) => (
              <th key={field.id} className="px-3 py-2 font-medium whitespace-nowrap">
                {field.name}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {groupedTasks.map((group) => (
            <Fragment key={group.label}>
              <tr className="bg-white/3 border-b border-white/10">
                <td colSpan={17 + customFields.length} className="px-3 py-2 text-xs font-semibold text-white/80">
                  {group.label} ({group.rows.length})
                </td>
              </tr>

              {group.rows.map((task) => (
                <tr key={task.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-3 py-2 font-medium text-white/95">{task.name}</td>
                  <td className="px-3 py-2 text-white/80 max-w-75 truncate">{task.description || "-"}</td>
                  <td className="px-3 py-2 text-white/80">{typeof task.duration === "number" ? `${task.duration}m` : "-"}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.startDate)}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.deadline)}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.scheduledOn)}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.completedAt)}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.createdAt)}</td>
                  <td className="px-3 py-2 text-white/80">{formatDate(task.updatedAt)}</td>
                  <td className="px-3 py-2 text-white/80">{task.project?.name || task.project?.title || "-"}</td>
                  <td className="px-3 py-2 text-white/80">{task.workspace?.name || "-"}</td>
                  <td className="px-3 py-2 text-white/80">{getBlockedByDisplayValue(task)}</td>
                  <td className="px-3 py-2 text-white/80">{task.priorityLevel || "-"}</td>
                  <td className="px-3 py-2 text-white/80">{task.stageId || task.stageid || "-"}</td>
                  <td className="px-3 py-2 text-white/80">{task.scheduleId || task.scheduleid || "-"}</td>

                  <td className="px-3 py-2">
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

                  <td className="px-3 py-2">
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
                    <td key={`${task.id}-${field.id}`} className="px-3 py-2 text-white/80">
                      {getCustomFieldDisplayValue(task, field.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
