"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, X } from "lucide-react";
import Select from "@/app/_components/_ui/select";
import type {
  CustomField,
  Project,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortBy,
  TaskListSortDirection,
  TaskRenderMode,
  Workspace,
} from "@/app/_types/types";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";

export type TaskListScope = "global" | "project";

const GLOBAL_GROUP_FIELDS: TaskListGroupField[] = [
  "workspace",
  "project",
  "stage",
  "status",
  "priority",
];

const PROJECT_GROUP_FIELDS: TaskListGroupField[] = ["stage", "status", "priority"];

const GLOBAL_DEFAULT_GROUPS: TaskListGroupField[] = ["workspace", "project", "stage"];

type TaskToolbarProps = {
  viewMode: TaskRenderMode;
  setViewMode: (value: TaskRenderMode) => void;
  groupFields: TaskListGroupField[];
  setGroupFields: (value: TaskListGroupField[]) => void;
  groupSortDirection: TaskListGroupSortDirection;
  setGroupSortDirection: (value: TaskListGroupSortDirection) => void;
  dataMode: TaskListDataMode;
  setDataMode: (value: TaskListDataMode) => void;
  groupValueOrders: Record<string, string[]>;
  setGroupValueOrders: (value: Record<string, string[]>) => void;
  groupOptionsByField: Record<string, string[]>;
  workspaces: Workspace[];
  selectedWorkspaceIds: string[];
  setSelectedWorkspaceIds: (value: string[]) => void;
  selectedStatusIds: string[];
  setSelectedStatusIds: (value: string[]) => void;
  dataCount: number;
  sortBy: TaskListSortBy;
  setSortBy: (value: TaskListSortBy) => void;
  sortDirection: TaskListSortDirection;
  setSortDirection: (value: TaskListSortDirection) => void;
  customFields: CustomField[];
  showReminders: boolean;
  setShowReminders: (value: boolean) => void;
  /** Project hub lists are already scoped, so workspace/project tools stay hidden. */
  scope?: TaskListScope;
  defaultGroupFields?: TaskListGroupField[];
};

/** Provides view selection, search, filtering, sorting, and grouping controls. */
export function TaskToolbar({
  viewMode,
  setViewMode,
  groupFields,
  setGroupFields,
  groupSortDirection,
  setGroupSortDirection,
  dataMode,
  setDataMode,
  groupValueOrders,
  setGroupValueOrders,
  groupOptionsByField,
  workspaces,
  selectedWorkspaceIds,
  setSelectedWorkspaceIds,
  selectedStatusIds,
  setSelectedStatusIds,
  dataCount,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  customFields,
  showReminders,
  setShowReminders,
  scope = "global",
  defaultGroupFields,
}: TaskToolbarProps) {
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupSortPanelOpen, setGroupSortPanelOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null);
  const [dragGroupValue, setDragGroupValue] = useState<{
    field: TaskListGroupField;
    index: number;
  } | null>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const groupSortPanelRef = useRef<HTMLDivElement>(null);
  const workspacePanelRef = useRef<HTMLDivElement>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);
  const isProjectScope = scope === "project";

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      if (groupPanelOpen && groupPanelRef.current && !groupPanelRef.current.contains(target)) {
        setGroupPanelOpen(false);
      }

      if (
        groupSortPanelOpen &&
        groupSortPanelRef.current &&
        !groupSortPanelRef.current.contains(target)
      ) {
        setGroupSortPanelOpen(false);
      }

      if (
        workspacePanelOpen &&
        workspacePanelRef.current &&
        !workspacePanelRef.current.contains(target)
      ) {
        setWorkspacePanelOpen(false);
      }

      if (statusPanelOpen && statusPanelRef.current && !statusPanelRef.current.contains(target)) {
        setStatusPanelOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGroupPanelOpen(false);
        setGroupSortPanelOpen(false);
        setWorkspacePanelOpen(false);
        setStatusPanelOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [groupPanelOpen, groupSortPanelOpen, workspacePanelOpen, statusPanelOpen]);

  const availableGroups: TaskListGroupField[] = [
    ...(isProjectScope ? PROJECT_GROUP_FIELDS : GLOBAL_GROUP_FIELDS),
    ...customFields.map((field) => `cf:${field.id}` as TaskListGroupField),
  ];

  const resetGroupFields = defaultGroupFields ?? (isProjectScope ? ["status"] : GLOBAL_DEFAULT_GROUPS);
  const currentGroups: TaskListGroupField[] = groupFields.slice(0, 3);

  const updateGroupField = (index: number, value: TaskListGroupField | "none") => {
    const next = [...currentGroups];
    if (value === "none") {
      next.splice(index, 1);
    } else {
      next[index] = value;
    }

    const normalized = next.filter(Boolean).slice(0, 3);
    setGroupFields(normalized);
  };

  const addGroupField = () => {
    if (currentGroups.length >= 3) return;
    const next = availableGroups.find((field) => !currentGroups.includes(field));
    if (!next) return;
    setGroupFields([...currentGroups, next]);
  };

  const resetGroups = () => {
    setGroupFields(resetGroupFields);
    setGroupSortDirection("asc");
    setGroupValueOrders({});
  };

  const reorderGroups = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= currentGroups.length || to >= currentGroups.length) {
      return;
    }
    const next = [...currentGroups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroupFields(next);
  };

  const reorderGroupValues = (field: TaskListGroupField, from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const base = groupOptionsByField[field] ?? [];
    const current = groupValueOrders[field] ?? base;
    if (from >= current.length || to >= current.length) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    setGroupValueOrders({
      ...groupValueOrders,
      [field]: next,
    });
  };

  const groupLabel = (value: TaskListGroupField) => {
    if (value.startsWith("cf:")) {
      const field = customFields.find((item) => item.id === value.slice(3));
      return field?.name ?? "Custom Field";
    }
    return value[0].toUpperCase() + value.slice(1);
  };

  const toggleWorkspace = (workspaceId: string) => {
    if (selectedWorkspaceIds.includes(workspaceId)) {
      setSelectedWorkspaceIds(selectedWorkspaceIds.filter((id) => id !== workspaceId));
      return;
    }
    setSelectedWorkspaceIds([...selectedWorkspaceIds, workspaceId]);
  };

  const scopedWorkspaces =
    selectedWorkspaceIds.length === 0
      ? workspaces
      : workspaces.filter((workspace) => selectedWorkspaceIds.includes(workspace.id));

  const statusOptions = scopedWorkspaces.flatMap((workspace) =>
    (workspace.status ?? []).map((status) => ({
      id: status.id,
      name: status.name,
      color: status.color,
      workspaceName: workspace.name,
    })),
  );
  const duplicateStatusNames = new Set(
    statusOptions
      .map((status) => status.name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );

  const toggleStatus = (statusId: string) => {
    const allIds = statusOptions.map((status) => status.id);
    const current = selectedStatusIds.length === 0 ? allIds : selectedStatusIds;

    const next = current.includes(statusId)
      ? current.filter((id) => id !== statusId)
      : [...current, statusId];

    setSelectedStatusIds(next.length === 0 || next.length === allIds.length ? [] : next);
  };

  const workspaceButtonLabel =
    selectedWorkspaceIds.length === 0
      ? "Workspace: All"
      : selectedWorkspaceIds.length === 1
        ? `Workspace: ${workspaces.find((item) => item.id === selectedWorkspaceIds[0])?.name ?? "Selected"}`
        : `Workspace: ${selectedWorkspaceIds.length} selected`;

  const selectedStatusLabel =
    selectedStatusIds.length === 0
      ? "Status: All"
      : selectedStatusIds.length === 1
        ? `Status: ${statusOptions.find((status) => status.id === selectedStatusIds[0])?.name ?? "Selected"}`
        : `Status: ${selectedStatusIds.length} selected`;

  const sortOptions = [
    { value: "name", label: "Name" },
    { value: "deadline", label: "Deadline" },
    { value: "startDate", label: "Start date" },
    { value: "createdAt", label: "Created at" },
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    ...(isProjectScope ? [] : [{ value: "project", label: "Project" }]),
  ];

  const dataModeOptions = [
    { value: "task", label: "Tasks" },
    { value: "reminder", label: "Reminders" },
    ...(isProjectScope ? [] : [{ value: "project", label: "Projects" }]),
  ];

  return (
    <div className="flex h-12 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <div className="relative" ref={groupPanelRef}>
          <button
            className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
            onClick={() => setGroupPanelOpen((prev) => !prev)}
          >
            Group by: {currentGroups.length ? currentGroups.map(groupLabel).join(" > ") : "None"}
            <ChevronDown size={14} />
          </button>

          {groupPanelOpen && (
            <div className="absolute top-9 left-0 z-40 w-[320px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Groups</h4>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={resetGroups}>
                  Reset
                </button>
              </div>

              <div className="space-y-2">
                {currentGroups.map((value, index) => (
                  <div
                    key={`group-field-${index}`}
                    className="flex items-center gap-2"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragGroupIndex(index);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragGroupIndex !== null) {
                        reorderGroups(dragGroupIndex, index);
                      }
                      setDragGroupIndex(null);
                    }}
                    onDragEnd={() => setDragGroupIndex(null)}
                  >
                    <span className="cursor-grab text-muted-foreground active:cursor-grabbing">
                      <GripVertical size={14} />
                    </span>

                    <div className="flex-1">
                      <Select
                        size="sm"
                        value={value}
                        onChange={(next) => updateGroupField(index, next as TaskListGroupField | "none")}
                        options={availableGroups.map((option) => ({
                          value: option,
                          label: groupLabel(option),
                        }))}
                      />
                    </div>

                    <button
                      className="p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => updateGroupField(index, "none")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  disabled={currentGroups.length >= 3}
                  onClick={addGroupField}
                >
                  + Add Group ({currentGroups.length}/3)
                </button>

                <button
                  className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => setGroupSortDirection(groupSortDirection === "asc" ? "desc" : "asc")}
                >
                  Sort {groupSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <label className="mb-1 block text-xs text-muted-foreground">Data</label>
                <Select
                  size="sm"
                  value={showReminders ? "reminder" : dataMode}
                  onChange={(next) => {
                    if (next === "reminder") {
                      setShowReminders(true);
                      setDataMode("task");
                      return;
                    }
                    setShowReminders(false);
                    setDataMode(next as TaskListDataMode);
                  }}
                  options={dataModeOptions}
                />
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={groupSortPanelRef}>
          <button
            className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setGroupSortPanelOpen((prev) => !prev)}
          >
            Sort Groups
          </button>

          {groupSortPanelOpen && (
            <div className="absolute top-9 left-0 z-40 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
              <div className="flex">
                {currentGroups.map((field) => {
                  const values = groupValueOrders[field] ?? groupOptionsByField[field] ?? [];
                  return (
                    <div key={`sort-field-${field}`} className="w-60 border-r border-border last:border-r-0">
                      <div className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
                        {groupLabel(field)}
                      </div>

                      <div className="max-h-64 space-y-1 overflow-auto p-2">
                        {values.map((value, index) => (
                          <div
                            key={`${field}-${value}`}
                            className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              setDragGroupValue({ field, index });
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (dragGroupValue && dragGroupValue.field === field) {
                                reorderGroupValues(field, dragGroupValue.index, index);
                              }
                              setDragGroupValue(null);
                            }}
                            onDragEnd={() => setDragGroupValue(null)}
                          >
                            <span className="cursor-grab text-muted-foreground active:cursor-grabbing">
                              <GripVertical size={14} />
                            </span>
                            <span className="flex-1 truncate text-sm text-foreground">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
          <button
            className={`min-w-16 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition ${
              viewMode === "list"
                ? "bg-background font-medium text-foreground shadow-xs"
                : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
          >
            List
          </button>

          <button
            className={`min-w-16 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition ${
              viewMode === "kanban"
                ? "bg-background font-medium text-foreground shadow-xs"
                : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setViewMode("kanban")}
            aria-pressed={viewMode === "kanban"}
          >
            Kanban
          </button>

          <button
            className={`min-w-16 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition ${
              viewMode === "gantt"
                ? "bg-background font-medium text-foreground shadow-xs"
                : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setViewMode("gantt")}
            aria-pressed={viewMode === "gantt"}
          >
            Gantt
          </button>
        </div>

        <label className="text-xs text-muted-foreground">Sort</label>

        <div className="w-36">
          <Select
            size="sm"
            value={sortBy}
            onChange={(next) => setSortBy(next as TaskListSortBy)}
            options={sortOptions}
          />
        </div>

        <button
          className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
        >
          {sortDirection === "asc" ? "Asc" : "Desc"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative" ref={statusPanelRef}>
          <button
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setStatusPanelOpen((prev) => !prev)}
          >
            {selectedStatusLabel}
            <ChevronDown size={14} />
          </button>

          {statusPanelOpen && (
            <div className="absolute top-9 right-0 z-40 w-64 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Statuses</h4>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedStatusIds([])}
                >
                  All
                </button>
              </div>

              <div className="max-h-56 space-y-1 overflow-auto">
                {statusOptions.map((status) => {
                  const checked = selectedStatusIds.length === 0 || selectedStatusIds.includes(status.id);
                  const label = duplicateStatusNames.has(status.name)
                    ? `${status.name} · ${status.workspaceName}`
                    : status.name;

                  return (
                    <label
                      key={status.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStatus(status.id)}
                        className="accent-primary"
                      />
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
                      <span className="truncate text-sm text-foreground">{label}</span>
                    </label>
                  );
                })}

                {statusOptions.length === 0 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">No statuses found</div>
                )}
              </div>
            </div>
          )}
        </div>

        {!isProjectScope ? (
          <div className="relative" ref={workspacePanelRef}>
            <button
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setWorkspacePanelOpen((prev) => !prev)}
            >
              {workspaceButtonLabel}
              <ChevronDown size={14} />
            </button>

            {workspacePanelOpen && (
              <div className="absolute top-9 right-0 z-40 w-64 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Workspaces</h4>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedWorkspaceIds([])}
                  >
                    All
                  </button>
                </div>

                <div className="max-h-56 space-y-1 overflow-auto">
                  {workspaces.map((workspace) => {
                    const checked = selectedWorkspaceIds.includes(workspace.id);
                    return (
                      <label
                        key={workspace.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWorkspace(workspace.id)}
                          className="accent-primary"
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: workspace.color || "var(--muted-foreground)",
                          }}
                        />
                        <span className="text-sm text-foreground">{workspace.name}</span>
                      </label>
                    );
                  })}

                  {workspaces.length === 0 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No workspaces found</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <span className="text-xs text-muted-foreground">
          {dataMode === "task" ? (showReminders ? "REMINDERS" : "TASKS") : "PROJECTS"}: {dataCount}
        </span>
      </div>
    </div>
  );
}

/** Displays active task-view options and a compact summary of the result set. */
export function TaskOptionsBar({
  showCompleted,
  setShowCompleted,
  onlyOverdue,
  setOnlyOverdue,
  onlyScheduled,
  setOnlyScheduled,
  onlyRecurring,
  setOnlyRecurring,
  onlyDated,
  setOnlyDated,
  projects,
  workspaces,
  selectedProjectIds,
  setSelectedProjectIds,
  selectedPriorityLevels,
  setSelectedPriorityLevels,
  selectedLabelIds,
  setSelectedLabelIds,
  selectedStageIds,
  setSelectedStageIds,
  scope = "global",
}: {
  showCompleted: boolean;
  setShowCompleted: (value: boolean) => void;
  onlyOverdue: boolean;
  setOnlyOverdue: (value: boolean) => void;
  onlyScheduled: boolean;
  setOnlyScheduled: (value: boolean) => void;
  onlyRecurring: boolean;
  setOnlyRecurring: (value: boolean) => void;
  onlyDated: boolean;
  setOnlyDated: (value: boolean) => void;
  projects: Project[];
  workspaces: Workspace[];
  selectedProjectIds: string[];
  setSelectedProjectIds: (value: string[]) => void;
  selectedPriorityLevels: string[];
  setSelectedPriorityLevels: (value: string[]) => void;
  selectedLabelIds: string[];
  setSelectedLabelIds: (value: string[]) => void;
  selectedStageIds: string[];
  setSelectedStageIds: (value: string[]) => void;
  scope?: TaskListScope;
}) {
  const isProjectScope = scope === "project";
  const labels = workspaces.flatMap((workspace) => workspace.lables ?? []);
  const stages = projects.flatMap((project) =>
    (project.stages ?? []).map((stage) => ({
      id: stage.id,
      label: isProjectScope ? stage.name : `${project.title}: ${stage.name}`,
      color: stage.color ?? undefined,
    })),
  );

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-sm text-muted-foreground">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={onlyOverdue}
          onChange={(event) => setOnlyOverdue(event.target.checked)}
        />
        Overdue
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
        />
        Show completed
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={onlyScheduled}
          onChange={(event) => setOnlyScheduled(event.target.checked)}
        />
        Scheduled
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={onlyRecurring}
          onChange={(event) => setOnlyRecurring(event.target.checked)}
        />
        Recurring
      </label>
      <label
        className="flex items-center gap-2"
        title="Only tasks with a deadline or reserved calendar time"
      >
        <input
          type="checkbox"
          className="accent-primary"
          checked={onlyDated}
          onChange={(event) => setOnlyDated(event.target.checked)}
        />
        Dated only
      </label>
      {!isProjectScope ? (
        <div className="w-40">
          <Select
            size="sm"
            value={selectedProjectIds[0] ?? ""}
            placeholder="Project"
            onChange={(projectId) => setSelectedProjectIds(projectId ? [projectId] : [])}
            options={[
              { value: "", label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.title,
                color: project.color ?? undefined,
              })),
            ]}
          />
        </div>
      ) : null}
      <div className="w-32">
        <Select
          size="sm"
          value={selectedPriorityLevels[0] ?? ""}
          placeholder="Priority"
          onChange={(priority) => setSelectedPriorityLevels(priority ? [priority] : [])}
          options={[{ value: "", label: "All priorities" }, ...PRIORITY_OPTIONS]}
        />
      </div>
      {labels.length > 0 ? (
        <div className="w-36">
          <Select
            size="sm"
            value={selectedLabelIds[0] ?? ""}
            placeholder="Label"
            onChange={(labelId) => setSelectedLabelIds(labelId ? [labelId] : [])}
            options={[
              { value: "", label: "All labels" },
              ...labels.map((label) => ({ value: label.id, label: label.name, color: label.color })),
            ]}
          />
        </div>
      ) : null}
      {stages.length > 0 ? (
        <div className="w-44">
          <Select
            size="sm"
            value={selectedStageIds[0] ?? ""}
            placeholder="Stage"
            onChange={(stageId) => setSelectedStageIds(stageId ? [stageId] : [])}
            options={[
              { value: "", label: "All stages" },
              ...stages.map((stage) => ({
                value: stage.id,
                label: stage.label,
                color: stage.color,
              })),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
