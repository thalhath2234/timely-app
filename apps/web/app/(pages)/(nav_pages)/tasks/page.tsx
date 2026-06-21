"use client";

import { useMemo, useState } from "react";
import {
  Config,
  CustomField,
  TaskListGroupBy,
  TaskListSortBy,
  TaskListSortDirection,
} from "@/app/_types/types";
import { useConfig } from "@/app/utils/hooks/workspaces";
import { MoreHorizontal, Plus, Pencil, Search } from "lucide-react";
import TasksTable from "@/app/_components/_ui/tasks/tasktable";

type TaskViewMode = "list" | "kanban" | "gantt";

export default function Tasks() {
  const { data: config, isLoading, status } = useConfig();
  const [viewMode, setViewMode] = useState<TaskViewMode>("list");
  const [groupBy, setGroupBy] = useState<TaskListGroupBy>("none");
  const [sortBy, setSortBy] = useState<TaskListSortBy>("deadline");
  const [sortDirection, setSortDirection] = useState<TaskListSortDirection>("asc");

  const typedConfig = config as Config | undefined;
  const customFields = useMemo(
    () => typedConfig?.customFields ?? [],
    [typedConfig?.customFields]
  );

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (status === "error") {
    return <div>Something went wrong</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <TaskHeader />

      <TaskNavigationBar />

      <TaskToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortDirection={sortDirection}
        setSortDirection={setSortDirection}
        customFields={customFields}
      />

      <TaskOptionsBar />

      <div className="flex-1 overflow-auto">
        {typedConfig && viewMode === "list" && (
          <TasksTable
            config={typedConfig}
            groupBy={groupBy}
            sortBy={sortBy}
            sortDirection={sortDirection}
          />
        )}

        {viewMode !== "list" && (
          <div className="p-4 text-sm text-white/70">
            {viewMode[0].toUpperCase() + viewMode.slice(1)} view is coming soon.
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskHeader() {
  return (
    <div className="h-14 border-b border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="size-5 rounded bg-blue-500" />

        <h1 className="font-semibold text-white">Projects & Tasks</h1>

        <button>
          <MoreHorizontal size={16} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button className="text-xs px-3 py-1 rounded bg-secondary border border-white/10">
          Create Dashboard
        </button>
      </div>
    </div>
  );
}

export function TaskNavigationBar() {
  return (
    <div className="h-12 border-b border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-6 text-sm">
        <button className="font-medium border-b">Task List</button>

        <button>My Tasks</button>

        <button>My Deadlines</button>

        <button>Overview</button>

        <button>Project Timelines</button>

        <button>Team Schedule</button>

        <div className="flex gap-1">
          <button className="p-1 rounded bg-secondary">
            <Pencil size={14} />
          </button>

          <button className="p-1 rounded bg-secondary">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Search size={14} />
          Search
        </div>

        <button className="text-sm">Hide options</button>
      </div>
    </div>
  );
}

type TaskToolbarProps = {
  viewMode: TaskViewMode;
  setViewMode: (value: TaskViewMode) => void;
  groupBy: TaskListGroupBy;
  setGroupBy: (value: TaskListGroupBy) => void;
  sortBy: TaskListSortBy;
  setSortBy: (value: TaskListSortBy) => void;
  sortDirection: TaskListSortDirection;
  setSortDirection: (value: TaskListSortDirection) => void;
  customFields: CustomField[];
};

export function TaskToolbar({
  viewMode,
  setViewMode,
  groupBy,
  setGroupBy,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  customFields,
}: TaskToolbarProps) {
  return (
    <div className="h-12 border-b border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-white/70">Group by</label>

        <select
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value as TaskListGroupBy)}
          className="px-2 py-1 rounded bg-secondary border border-white/10 text-xs"
        >
          <option value="none">None</option>
          <option value="status">Status</option>
          <option value="project">Project</option>
          <option value="priority">Priority</option>
          {customFields.map((field) => (
            <option key={field.id} value={`cf:${field.id}`}>
              {field.name}
            </option>
          ))}
        </select>

        <button className="px-2 py-1 rounded bg-secondary text-xs">
          Sort Groups
        </button>

        <div className="flex rounded overflow-hidden border border-white/10">
          <button
            className={`px-2 py-1 text-xs ${
              viewMode === "list" ? "bg-secondary" : "bg-transparent"
            }`}
            onClick={() => setViewMode("list")}
          >
            List
          </button>

          <button
            className={`px-2 py-1 text-xs ${
              viewMode === "kanban" ? "bg-secondary" : "bg-transparent"
            }`}
            onClick={() => setViewMode("kanban")}
          >
            Kanban
          </button>

          <button
            className={`px-2 py-1 text-xs ${
              viewMode === "gantt" ? "bg-secondary" : "bg-transparent"
            }`}
            onClick={() => setViewMode("gantt")}
          >
            Gantt
          </button>
        </div>

        <label className="text-xs text-white/70">Sort</label>

        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as TaskListSortBy)}
          className="px-2 py-1 rounded bg-secondary border border-white/10 text-xs"
        >
          <option value="name">Name</option>
          <option value="deadline">Deadline</option>
          <option value="startDate">Start date</option>
          <option value="createdAt">Created at</option>
          <option value="priority">Priority</option>
          <option value="status">Status</option>
          <option value="project">Project</option>
        </select>

        <button
          className="px-2 py-1 rounded bg-secondary text-xs"
          onClick={() =>
            setSortDirection(sortDirection === "asc" ? "desc" : "asc")
          }
        >
          {sortDirection === "asc" ? "Asc" : "Desc"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button className="px-2 py-1 rounded bg-secondary text-xs">
          Workspace: All
        </button>

        <button className="px-2 py-1 rounded bg-secondary text-xs">
          Filters (0)
        </button>

        <span className="text-xs text-white/60">TASKS: 12</span>
      </div>
    </div>
  );
}

export function TaskOptionsBar() {
  return (
    <div className="h-10 border-b border-white/10 flex items-center gap-6 px-4 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" />
        Only show scheduled past deadline
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" />
        Show resolved tasks
      </label>
    </div>
  );
}
