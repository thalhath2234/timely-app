"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Config,
  CustomField,
  Task,
  TaskRenderMode,
  TaskViewConfig,
  Workspace,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortBy,
  TaskListSortDirection,
} from "@/app/_types/types";
import { useConfig, useUpdateTaskViewsConfig, useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useTasks } from "@/app/utils/hooks/tasks";
import { ApiError } from "@/app/utils/api/worksapce";
import { ChevronDown, GripVertical, MoreHorizontal, Plus, Pencil, Search, X } from "lucide-react";
import TasksTable from "@/app/_components/_ui/tasks/tasktable";

type TaskViewMode = TaskRenderMode;

const areStringArraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const areRecordsOfStringArraysEqual = (
  a: Record<string, string[]>,
  b: Record<string, string[]>
) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) => {
    const aValues = a[key] ?? [];
    const bValues = b[key] ?? [];
    return areStringArraysEqual(aValues, bValues);
  });
};

const NEW_VIEW_TEMPLATE: Omit<TaskViewConfig, "id" | "name"> = {
  dataMode: "task",
  renderMode: "list",
  groupFields: ["workspace", "project", "stage"],
  groupSortDirection: "asc",
  groupValueOrders: {},
  sortBy: "deadline",
  sortDirection: "asc",
  selectedWorkspaceIds: [],
};

export default function Tasks() {
  const queryClient = useQueryClient();
  const { data: config, isLoading, status } = useConfig();
  const { data: workspaces } = useWorkspaces();
  const { data: tasks } = useTasks();
  const [taskViews, setTaskViews] = useState<TaskViewConfig[]>([]);
  const [activeTaskViewId, setActiveTaskViewId] = useState<string>("");
  const [viewsReady, setViewsReady] = useState(false);
  const [viewMode, setViewMode] = useState<TaskViewMode>("list");
  const [groupFields, setGroupFields] = useState<TaskListGroupField[]>([
    "workspace",
    "project",
    "stage",
  ]);
  const [groupSortDirection, setGroupSortDirection] =
    useState<TaskListGroupSortDirection>("asc");
  const [dataMode, setDataMode] = useState<TaskListDataMode>("task");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [groupValueOrders, setGroupValueOrders] = useState<Record<string, string[]>>({});
  const [sortBy, setSortBy] = useState<TaskListSortBy>("deadline");
  const [sortDirection, setSortDirection] = useState<TaskListSortDirection>("asc");
  const [syncError, setSyncError] = useState<string>("");
  const hydratingFromViewRef = useRef(false);

  const typedConfig = config as Config | undefined;
  const typedWorkspaces = useMemo(() => (workspaces ?? []) as Workspace[], [workspaces]);
  const typedTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const customFields = useMemo(
    () => typedConfig?.customFields ?? [],
    [typedConfig?.customFields]
  );

  const saveViewsMutation = useUpdateTaskViewsConfig();

  useEffect(() => {
    const configViews = typedConfig?.taskViews ?? [];

    const nextActiveId =
      typedConfig?.activeTaskViewId &&
      configViews.some((view) => view.id === typedConfig.activeTaskViewId)
        ? typedConfig.activeTaskViewId
        : configViews[0]?.id ?? "";

    setTaskViews(configViews);
    setActiveTaskViewId(nextActiveId);
    setViewsReady(true);
  }, [typedConfig?.id, typedConfig?.taskViews, typedConfig?.activeTaskViewId]);

  const activeTaskView = useMemo(
    () => taskViews.find((view) => view.id === activeTaskViewId),
    [taskViews, activeTaskViewId]
  );

  useEffect(() => {
    if (!activeTaskView) return;

    hydratingFromViewRef.current = true;

    setViewMode((previous) =>
      previous === activeTaskView.renderMode ? previous : activeTaskView.renderMode
    );
    setGroupFields((previous) =>
      areStringArraysEqual(previous, activeTaskView.groupFields)
        ? previous
        : activeTaskView.groupFields
    );
    setGroupSortDirection((previous) =>
      previous === activeTaskView.groupSortDirection
        ? previous
        : activeTaskView.groupSortDirection
    );
    setDataMode((previous) =>
      previous === activeTaskView.dataMode ? previous : activeTaskView.dataMode
    );
    setSelectedWorkspaceIds((previous) =>
      areStringArraysEqual(previous, activeTaskView.selectedWorkspaceIds)
        ? previous
        : activeTaskView.selectedWorkspaceIds
    );
    setGroupValueOrders((previous) =>
      areRecordsOfStringArraysEqual(previous, activeTaskView.groupValueOrders)
        ? previous
        : activeTaskView.groupValueOrders
    );
    setSortBy((previous) => (previous === activeTaskView.sortBy ? previous : activeTaskView.sortBy));
    setSortDirection((previous) =>
      previous === activeTaskView.sortDirection ? previous : activeTaskView.sortDirection
    );

    const hydrationTimer = setTimeout(() => {
      hydratingFromViewRef.current = false;
    }, 0);

    return () => {
      clearTimeout(hydrationTimer);
      hydratingFromViewRef.current = false;
    };
  }, [activeTaskView]);

  useEffect(() => {
    if (!viewsReady || !activeTaskViewId || hydratingFromViewRef.current) return;

    setTaskViews((previous) => {
      let changed = false;
      const next = previous.map((view) => {
        if (view.id !== activeTaskViewId) return view;

        const updated: TaskViewConfig = {
          ...view,
          renderMode: viewMode,
          groupFields,
          groupSortDirection,
          dataMode,
          selectedWorkspaceIds,
          groupValueOrders,
          sortBy,
          sortDirection,
        };

        const isUnchanged =
          updated.renderMode === view.renderMode &&
          updated.groupSortDirection === view.groupSortDirection &&
          updated.dataMode === view.dataMode &&
          updated.sortBy === view.sortBy &&
          updated.sortDirection === view.sortDirection &&
          areStringArraysEqual(updated.groupFields, view.groupFields) &&
          areStringArraysEqual(updated.selectedWorkspaceIds, view.selectedWorkspaceIds) &&
          areRecordsOfStringArraysEqual(updated.groupValueOrders, view.groupValueOrders);

        if (!isUnchanged) {
          changed = true;
          return updated;
        }
        return view;
      });

      return changed ? next : previous;
    });
  }, [
    viewsReady,
    activeTaskViewId,
    viewMode,
    groupFields,
    groupSortDirection,
    dataMode,
    selectedWorkspaceIds,
    groupValueOrders,
    sortBy,
    sortDirection,
  ]);

  useEffect(() => {
    if (!viewsReady || taskViews.length === 0) return;

    const resolvedActiveTaskViewId =
      activeTaskViewId && taskViews.some((view) => view.id === activeTaskViewId)
        ? activeTaskViewId
        : taskViews[0]?.id ?? "";

    if (!resolvedActiveTaskViewId) return;

    const timer = setTimeout(() => {
      setSyncError("");
      queryClient.setQueryData(["config"], (old: Config | undefined) => {
        if (!old) return old;
        return {
          ...old,
          taskViews,
          activeTaskViewId: resolvedActiveTaskViewId,
        };
      });

      saveViewsMutation.mutate(
        {
          taskViews,
          activeTaskViewId: resolvedActiveTaskViewId,
        },
        {
          onError: async (error) => {
            if (error instanceof ApiError && error.status === 409) {
              setSyncError("Config conflict: reloading latest config...");
              await queryClient.invalidateQueries({ queryKey: ["config"] });
              await queryClient.refetchQueries({ queryKey: ["config"], type: "active" });
              return;
            }

            setSyncError("Failed to sync config changes. Please retry.");
          },
        }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [viewsReady, taskViews, activeTaskViewId]);

  const addNewView = () => {
    const base = activeTaskView ?? taskViews[0];
    const id = `view_${Date.now()}`;
    const name = `New View ${taskViews.length + 1}`;

    const nextView: TaskViewConfig = {
      ...(base ?? NEW_VIEW_TEMPLATE),
      id,
      name,
    };

    setTaskViews((previous) => [...previous, nextView]);
    setActiveTaskViewId(id);
  };

  const deleteActiveView = () => {
    if (!activeTaskViewId || taskViews.length <= 1) return;

    setTaskViews((previous) => {
      const activeIndex = previous.findIndex((view) => view.id === activeTaskViewId);
      const next = previous.filter((view) => view.id !== activeTaskViewId);

      const fallbackIndex = activeIndex > 0 ? activeIndex - 1 : 0;
      const fallbackId = next[fallbackIndex]?.id ?? next[0]?.id ?? "";
      setActiveTaskViewId(fallbackId);

      return next;
    });
  };

  const renameView = (viewId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    setTaskViews((previous) =>
      previous.map((view) =>
        view.id === viewId && view.name !== nextName
          ? {
              ...view,
              name: nextName,
            }
          : view,
      ),
    );
  };

  const dataRows = useMemo(() => {
    if (dataMode === "task") return typedTasks;

    const projects = new Map<string, Task[]>();
    typedTasks.forEach((task) => {
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
      } as Task;
    });
  }, [dataMode, typedTasks]);

  const getGroupLabel = (task: Task, groupBy: TaskListGroupField): string => {
    if (groupBy === "workspace") return task.workspace?.name || "No workspace";
    if (groupBy === "project") return task.project?.title || task.project?.name || "No project";
    if (groupBy === "status") return task.status?.name || "No status";
    if (groupBy === "priority") return task.priorityLevel || "No priority";
    if (groupBy === "stage") return task.stageId || task.stageid || "No stage";
    if (groupBy.startsWith("cf:")) {
      const value = task.customFieldValues?.find((entry) => entry.customFieldId === groupBy.slice(3));
      if (!value) return "-";
      if (value.optionValue?.length) return value.optionValue.map((option) => option.value).join(", ");
      if (value.stringValue) return value.stringValue;
      if (typeof value.numberValue === "number") return String(value.numberValue);
      if (value.dateValue) return value.dateValue;
      if (typeof value.boolValue === "boolean") return value.boolValue ? "Yes" : "No";
      return "-";
    }
    return "No group";
  };

  const groupOptionsByField = useMemo(() => {
    const options: Record<string, string[]> = {};
    groupFields.forEach((field) => {
      const values = new Set<string>();
      dataRows.forEach((row) => values.add(getGroupLabel(row, field)));
      options[field] = Array.from(values).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
      );
    });
    return options;
  }, [dataRows, groupFields]);

  const filteredDataRows = useMemo(() => {
    if (selectedWorkspaceIds.length === 0) return dataRows;

    return dataRows.filter((row) => {
      const workspaceId = row.workspace?.id || row.workspaceId || row.workspaceid;
      if (!workspaceId) return false;
      return selectedWorkspaceIds.includes(workspaceId);
    });
  }, [dataRows, selectedWorkspaceIds]);

  const dataCount = filteredDataRows.length;

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (status === "error") {
    return <div>Something went wrong</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <TaskHeader />

      <TaskNavigationBar
        views={taskViews}
        activeTaskViewId={activeTaskViewId}
        onSelectView={setActiveTaskViewId}
        onAddView={addNewView}
        onDeleteView={deleteActiveView}
        onRenameView={renameView}
      />

      {taskViews.length === 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-white/10 bg-[#111923] p-4 text-sm text-white/75">
          No task views found in config. Create a new view using the + button.
        </div>
      )}

      {syncError && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {syncError}
        </div>
      )}

      {taskViews.length > 0 && (
        <>
          <TaskToolbar
            viewMode={viewMode}
            setViewMode={setViewMode}
            groupFields={groupFields}
            setGroupFields={setGroupFields}
            groupSortDirection={groupSortDirection}
            setGroupSortDirection={setGroupSortDirection}
            dataMode={dataMode}
            setDataMode={setDataMode}
            groupValueOrders={groupValueOrders}
            setGroupValueOrders={setGroupValueOrders}
            groupOptionsByField={groupOptionsByField}
            workspaces={typedWorkspaces}
            selectedWorkspaceIds={selectedWorkspaceIds}
            setSelectedWorkspaceIds={setSelectedWorkspaceIds}
            dataCount={dataCount}
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
                groupFields={groupFields}
                groupSortDirection={groupSortDirection}
                groupValueOrders={groupValueOrders}
                selectedWorkspaceIds={selectedWorkspaceIds}
                dataMode={dataMode}
                sortBy={sortBy}
                sortDirection={sortDirection}
              />
            )}

            {viewMode === "kanban" && (
              <KanbanView rows={filteredDataRows} dataMode={dataMode} />
            )}

            {viewMode === "gantt" && (
              <GanttView rows={filteredDataRows} dataMode={dataMode} />
            )}
          </div>
        </>
      )}
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

type TaskNavigationBarProps = {
  views: TaskViewConfig[];
  activeTaskViewId: string;
  onSelectView: (viewId: string) => void;
  onAddView: () => void;
  onDeleteView: () => void;
  onRenameView: (viewId: string, name: string) => void;
};

export function TaskNavigationBar({
  views,
  activeTaskViewId,
  onSelectView,
  onAddView,
  onDeleteView,
  onRenameView,
}: TaskNavigationBarProps) {
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const startRenaming = () => {
    const active = views.find((view) => view.id === activeTaskViewId);
    if (!active) return;

    setEditingViewId(active.id);
    setDraftName(active.name);
  };

  const applyRename = () => {
    if (!editingViewId) return;
    onRenameView(editingViewId, draftName);
    setEditingViewId(null);
    setDraftName("");
  };

  const cancelRename = () => {
    setEditingViewId(null);
    setDraftName("");
  };

  return (
    <div className="h-12 border-b border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-6 text-sm">
        {views.map((view) => {
          const isEditing = editingViewId === view.id;
          const isActive = view.id === activeTaskViewId;

          if (isEditing) {
            return (
              <input
                key={view.id}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={applyRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                autoFocus
                className="h-7 w-40 rounded border border-white/20 bg-[#111923] px-2 text-sm text-white/90 outline-none focus:border-blue-400/50"
              />
            );
          }

          return (
            <button
              key={view.id}
              className={
                isActive
                  ? "font-medium border-b border-white"
                  : "text-white/80 hover:text-white"
              }
              onClick={() => onSelectView(view.id)}
            >
              {view.name}
            </button>
          );
        })}

        <div className="flex gap-1">
          <button
            className="p-1 rounded bg-secondary"
            onClick={() => (editingViewId ? applyRename() : startRenaming())}
            title={editingViewId ? "Save view name" : "Rename active view"}
          >
            <Pencil size={14} />
          </button>

          <button className="p-1 rounded bg-secondary" onClick={onAddView}>
            <Plus size={14} />
          </button>

          <button
            className="p-1 rounded bg-secondary disabled:opacity-50"
            onClick={onDeleteView}
            disabled={views.length <= 1}
            title={views.length <= 1 ? "At least one view is required" : "Delete active view"}
          >
            <X size={14} />
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
  dataCount: number;
  sortBy: TaskListSortBy;
  setSortBy: (value: TaskListSortBy) => void;
  sortDirection: TaskListSortDirection;
  setSortDirection: (value: TaskListSortDirection) => void;
  customFields: CustomField[];
};

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
  dataCount,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  customFields,
}: TaskToolbarProps) {
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupSortPanelOpen, setGroupSortPanelOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null);
  const [dragGroupValue, setDragGroupValue] = useState<{
    field: TaskListGroupField;
    index: number;
  } | null>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const groupSortPanelRef = useRef<HTMLDivElement>(null);
  const workspacePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      if (
        groupPanelOpen &&
        groupPanelRef.current &&
        !groupPanelRef.current.contains(target)
      ) {
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
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGroupPanelOpen(false);
        setGroupSortPanelOpen(false);
        setWorkspacePanelOpen(false);
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
  }, [groupPanelOpen, groupSortPanelOpen, workspacePanelOpen]);

  const availableGroups: TaskListGroupField[] = [
    "workspace",
    "project",
    "stage",
    "status",
    "priority",
    ...customFields.map((field) => `cf:${field.id}` as TaskListGroupField),
  ];

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
    setGroupFields(["workspace", "project", "stage"]);
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

  const workspaceButtonLabel =
    selectedWorkspaceIds.length === 0
      ? "Workspace: All"
      : selectedWorkspaceIds.length === 1
      ? `Workspace: ${workspaces.find((item) => item.id === selectedWorkspaceIds[0])?.name ?? "Selected"}`
      : `Workspace: ${selectedWorkspaceIds.length} selected`;

  const dropdownSmallClass =
    "appearance-none bg-[#111923] border border-white/15 text-white/90 text-xs rounded-md px-2 py-1 pr-7 shadow-inner shadow-black/20 transition focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400/50 hover:border-white/25";

  const dropdownPanelClass =
    "appearance-none bg-[#0f141b] border border-white/15 text-white/90 text-sm rounded-md px-2 py-1.5 pr-8 shadow-inner shadow-black/20 transition focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400/50 hover:border-white/25";

  return (
    <div className="h-12 border-b border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="relative" ref={groupPanelRef}>
          <button
            className="px-2 py-1 rounded bg-blue-600/20 text-blue-300 text-xs inline-flex items-center gap-1"
            onClick={() => setGroupPanelOpen((prev) => !prev)}
          >
            Group by: {currentGroups.length ? currentGroups.map(groupLabel).join(" > ") : "None"}
            <ChevronDown size={14} />
          </button>

          {groupPanelOpen && (
            <div className="absolute top-9 left-0 z-40 w-[320px] rounded-xl border border-white/10 bg-[#1d252f] p-3 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-white/90">Groups</h4>
                <button className="text-xs text-white/70 hover:text-white" onClick={resetGroups}>
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
                    <span className="text-white/45 cursor-grab active:cursor-grabbing">
                      <GripVertical size={14} />
                    </span>

                    <div className="relative flex-1">
                      <select
                        value={value}
                        onChange={(event) =>
                          updateGroupField(index, event.target.value as TaskListGroupField | "none")
                        }
                        className={`w-full ${dropdownPanelClass}`}
                      >
                        {availableGroups.map((option) => (
                          <option key={option} value={option}>
                            {groupLabel(option)}
                          </option>
                        ))}
                      </select>

                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/60"
                      />
                    </div>

                    <button
                      className="p-1 text-white/60 hover:text-white"
                      onClick={() => updateGroupField(index, "none")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  className="px-2 py-1 rounded bg-secondary text-xs disabled:opacity-50"
                  disabled={currentGroups.length >= 3}
                  onClick={addGroupField}
                >
                  + Add Group ({currentGroups.length}/3)
                </button>

                <button
                  className="px-2 py-1 rounded bg-secondary text-xs"
                  onClick={() =>
                    setGroupSortDirection(groupSortDirection === "asc" ? "desc" : "asc")
                  }
                >
                  Sort {groupSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <label className="text-xs text-white/70 block mb-1">Data</label>
                <div className="relative">
                  <select
                    value={dataMode}
                    onChange={(event) => setDataMode(event.target.value as TaskListDataMode)}
                    className={`w-full ${dropdownPanelClass}`}
                  >
                    <option value="task">Task</option>
                    <option value="project">Project</option>
                  </select>

                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/60"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={groupSortPanelRef}>
          <button
            className="px-2 py-1 rounded bg-secondary text-xs"
            onClick={() => setGroupSortPanelOpen((prev) => !prev)}
          >
            Sort Groups
          </button>

          {groupSortPanelOpen && (
            <div className="absolute top-9 left-0 z-40 rounded-xl border border-white/10 bg-[#252b31] shadow-xl overflow-hidden">
              <div className="flex">
                {currentGroups.map((field) => {
                  const values = groupValueOrders[field] ?? groupOptionsByField[field] ?? [];
                  return (
                    <div key={`sort-field-${field}`} className="w-60 border-r last:border-r-0 border-white/10">
                      <div className="px-3 py-2 border-b border-white/10 text-sm font-semibold text-white/85">
                        {groupLabel(field)}
                      </div>

                      <div className="max-h-64 overflow-auto p-2 space-y-1">
                        {values.map((value, index) => (
                          <div
                            key={`${field}-${value}`}
                            className="flex items-center gap-2 rounded px-2 py-1.5 bg-[#2d3339]"
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
                            <span className="text-white/45 cursor-grab active:cursor-grabbing">
                              <GripVertical size={14} />
                            </span>
                            <span className="text-sm text-white/85 flex-1 truncate">{value}</span>
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

        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#0f141b] p-1">
          <button
            className={`min-w-16 px-2.5 py-1.5 text-xs rounded-md transition whitespace-nowrap ${
              viewMode === "list"
                ? "bg-blue-500/25 text-blue-100 font-medium shadow-[0_0_0_1px_rgba(96,165,250,0.45)]"
                : "bg-transparent text-white/70 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
          >
            List
          </button>

          <button
            className={`min-w-16 px-2.5 py-1.5 text-xs rounded-md transition whitespace-nowrap ${
              viewMode === "kanban"
                ? "bg-blue-500/25 text-blue-100 font-medium shadow-[0_0_0_1px_rgba(96,165,250,0.45)]"
                : "bg-transparent text-white/70 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => setViewMode("kanban")}
            aria-pressed={viewMode === "kanban"}
          >
            Kanban
          </button>

          <button
            className={`min-w-16 px-2.5 py-1.5 text-xs rounded-md transition whitespace-nowrap ${
              viewMode === "gantt"
                ? "bg-blue-500/25 text-blue-100 font-medium shadow-[0_0_0_1px_rgba(96,165,250,0.45)]"
                : "bg-transparent text-white/70 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => setViewMode("gantt")}
            aria-pressed={viewMode === "gantt"}
          >
            Gantt
          </button>
        </div>

        <label className="text-xs text-white/70">Sort</label>

        <div className="relative">
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as TaskListSortBy)}
            className={dropdownSmallClass}
          >
            <option value="name">Name</option>
            <option value="deadline">Deadline</option>
            <option value="startDate">Start date</option>
            <option value="createdAt">Created at</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="project">Project</option>
          </select>

          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/60"
          />
        </div>

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
        <div className="relative" ref={workspacePanelRef}>
          <button
            className="px-2 py-1 rounded bg-secondary text-xs inline-flex items-center gap-1"
            onClick={() => setWorkspacePanelOpen((prev) => !prev)}
          >
            {workspaceButtonLabel}
            <ChevronDown size={14} />
          </button>

          {workspacePanelOpen && (
            <div className="absolute top-9 right-0 z-40 w-64 rounded-xl border border-white/10 bg-[#1d252f] p-3 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-white/90">Workspaces</h4>
                <button
                  className="text-xs text-white/70 hover:text-white"
                  onClick={() => setSelectedWorkspaceIds([])}
                >
                  All
                </button>
              </div>

              <div className="max-h-56 overflow-auto space-y-1">
                {workspaces.map((workspace) => {
                  const checked = selectedWorkspaceIds.includes(workspace.id);
                  return (
                    <label
                      key={workspace.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWorkspace(workspace.id)}
                      />
                      <span className="text-sm text-white/85">{workspace.name}</span>
                    </label>
                  );
                })}

                {workspaces.length === 0 && (
                  <div className="text-xs text-white/60 px-2 py-1">No workspaces found</div>
                )}
              </div>
            </div>
          )}
        </div>

        <span className="text-xs text-white/60">
          {dataMode === "task" ? "TASKS" : "PROJECTS"}: {dataCount}
        </span>
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

type AlternateViewProps = {
  rows: Task[];
  dataMode: TaskListDataMode;
};

function formatDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function parseDateValue(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function KanbanView({ rows, dataMode }: AlternateViewProps) {
  const columns = useMemo(() => {
    const grouped = new Map<string, Task[]>();

    rows.forEach((row) => {
      const statusName = row.status?.name || "No status";
      const existing = grouped.get(statusName) ?? [];
      existing.push(row);
      grouped.set(statusName, existing);
    });

    return Array.from(grouped.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [rows]);

  if (columns.length === 0) {
    return <div className="p-4 text-sm text-white/70">No items found for Kanban view.</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-max p-4 flex gap-3">
        {columns.map(([column, items]) => (
          <section
            key={column}
            className="w-72 shrink-0 rounded-lg border border-white/10 bg-[#141b24]"
          >
            <header className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white/90 truncate">{column}</h3>
              <span className="text-xs text-white/50">{items.length}</span>
            </header>

            <div className="p-2 space-y-2 max-h-[calc(100vh-270px)] overflow-auto">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-md border border-white/10 bg-[#1b2430] p-3"
                >
                  <div className="text-sm text-white/90 font-medium line-clamp-2">{item.name}</div>
                  <div className="mt-1 text-xs text-white/60">
                    {dataMode === "project" ? "Project" : "Task"} • {item.workspace?.name || "No workspace"}
                  </div>
                  <div className="mt-2 text-xs text-white/70">
                    Deadline: {formatDateLabel(item.deadline)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function GanttView({ rows, dataMode }: AlternateViewProps) {
  const timelineRows = useMemo(() => {
    const normalized = rows.map((row) => {
      const start =
        parseDateValue(row.startDate) ||
        parseDateValue(row.createdAt) ||
        parseDateValue(row.updatedAt) ||
        new Date();

      const end =
        parseDateValue(row.deadline) ||
        parseDateValue(row.completedAt) ||
        parseDateValue(row.updatedAt) ||
        start;

      const safeEnd = end < start ? start : end;

      return {
        row,
        start,
        end: safeEnd,
      };
    });

    if (normalized.length === 0) {
      return {
        entries: [],
        min: new Date(),
        max: new Date(),
      };
    }

    const min = new Date(Math.min(...normalized.map((entry) => entry.start.getTime())));
    const max = new Date(Math.max(...normalized.map((entry) => entry.end.getTime())));

    normalized.sort((a, b) => a.start.getTime() - b.start.getTime());

    return {
      entries: normalized,
      min,
      max,
    };
  }, [rows]);

  const totalDurationMs = Math.max(
    24 * 60 * 60 * 1000,
    timelineRows.max.getTime() - timelineRows.min.getTime()
  );

  if (timelineRows.entries.length === 0) {
    return <div className="p-4 text-sm text-white/70">No items found for Gantt view.</div>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="min-w-245 rounded-lg border border-white/10 bg-[#141b24]">
        <div className="grid grid-cols-[320px_1fr] border-b border-white/10 bg-[#111923]">
          <div className="px-3 py-2 text-xs text-white/60 uppercase tracking-wide">{dataMode}</div>
          <div className="px-3 py-2 text-xs text-white/60 uppercase tracking-wide">
            {formatDateLabel(timelineRows.min.toISOString())} - {formatDateLabel(timelineRows.max.toISOString())}
          </div>
        </div>

        {timelineRows.entries.map(({ row, start, end }) => {
          const startOffset = start.getTime() - timelineRows.min.getTime();
          const endOffset = end.getTime() - timelineRows.min.getTime();
          const left = (startOffset / totalDurationMs) * 100;
          const width = Math.max(2, ((endOffset - startOffset) / totalDurationMs) * 100);

          return (
            <div
              key={row.id}
              className="grid grid-cols-[320px_1fr] border-b border-white/5 last:border-b-0"
            >
              <div className="px-3 py-3">
                <div className="text-sm text-white/90 truncate">{row.name}</div>
                <div className="text-xs text-white/60 mt-1 truncate">{row.workspace?.name || "No workspace"}</div>
              </div>

              <div className="px-3 py-3">
                <div className="relative h-8 rounded bg-[#1c2632] border border-white/10">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-4 rounded bg-blue-500/80"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                    }}
                  />
                </div>

                <div className="mt-1 text-[11px] text-white/60">
                  {formatDateLabel(start.toISOString())} - {formatDateLabel(end.toISOString())}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
