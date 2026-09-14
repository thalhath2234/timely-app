"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Project,
  Task,
  TaskViewConfig,
  Workspace,
  TaskListGroupField,
} from "@/app/_types/types";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useTasks } from "@/app/utils/hooks/tasks";
import { Plus, Pencil, X } from "lucide-react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import TasksTable from "@/app/_components/_ui/tasks/tasktable";
import EntityDetailPanel from "@/app/_components/_ui/tasks/entityDetailPanel";
import KanbanView from "@/app/_components/_ui/tasks/kanbanView";
import GanttView from "@/app/_components/_ui/tasks/ganttView";
import BulkActionBar from "@/app/_components/_ui/tasks/bulkActionBar";
import { TaskOptionsBar, TaskToolbar } from "@/app/_components/_ui/tasks/taskToolbar";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useProjects } from "@/app/utils/hooks/projects";
import { filterTasks } from "@/app/utils/taskFilters";
import { stageColorMap, stageNameMap } from "@/app/utils/stages";
import { useTaskViewsState } from "@/app/utils/hooks/taskViews";

/** Project rows are synthesised from their tasks and carry a prefixed id. */
const PROJECT_ROW_PREFIX = "project-";

// useSearchParams needs a Suspense boundary for the page to prerender.
export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading...</div>}>
      <Tasks />
    </Suspense>
  );
}

function Tasks() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const views = useTaskViewsState();
  const {
    configQuery,
    typedConfig,
    taskViews,
    activeTaskViewId,
    setActiveTaskViewId,
    patchActiveView,
    addNewView,
    deleteActiveView,
    renameView,
    syncError,
    viewMode,
    groupFields,
    groupSortDirection,
    dataMode,
    selectedWorkspaceIds,
    selectedStatusIds,
    selectedProjectIds,
    selectedPriorityLevels,
    selectedLabelIds,
    selectedStageIds,
    showCompleted,
    onlyOverdue,
    onlyScheduled,
    onlyRecurring,
    onlyDated,
    showReminders,
    columnOrder,
    groupValueOrders,
    sortBy,
    sortDirection,
  } = views;
  const { isLoading, status } = configQuery;
  const { data: workspaces } = useWorkspaces();
  const tasksQuery = useTasks();
  const { data: tasks } = tasksQuery;
  const { data: projects } = useProjects();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [optionsVisible, setOptionsVisible] = useState(true);

  const typedWorkspaces = useMemo(() => (workspaces ?? []) as Workspace[], [workspaces]);
  const typedProjects = useMemo(() => (projects ?? []) as Project[], [projects]);
  const allTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const customFields = useMemo(
    () => typedConfig?.customFields ?? [],
    [typedConfig?.customFields]
  );
  const stageNames = useMemo(() => stageNameMap(typedProjects), [typedProjects]);
  const stageColors = useMemo(() => stageColorMap(typedProjects), [typedProjects]);

  // The open row lives in the URL so an @mention can link straight to it.
  const detailTaskId = searchParams.get("taskId");
  const detailProjectId = searchParams.get("projectId");

  const openRow = useCallback(
    (row: Task) => {
      const query = row.id.startsWith(PROJECT_ROW_PREFIX)
        ? `projectId=${encodeURIComponent(row.id.slice(PROJECT_ROW_PREFIX.length))}`
        : `taskId=${encodeURIComponent(row.id)}`;

      router.push(`/tasks?${query}`, { scroll: false });
    },
    [router],
  );

  const closeDetail = useCallback(
    () => router.push("/tasks", { scroll: false }),
    [router],
  );

  const listFilters = useMemo(
    () => ({
      workspaceIds: selectedWorkspaceIds,
      statusIds: selectedStatusIds,
      projectIds: detailProjectId ? [detailProjectId] : selectedProjectIds,
      priorityLevels: selectedPriorityLevels,
      labelIds: selectedLabelIds,
      stageIds: selectedStageIds,
      showCompleted,
      onlyOverdue,
      onlyScheduled,
      onlyRecurring,
      onlyDated,
      showReminders,
    }),
    [
      selectedWorkspaceIds,
      selectedStatusIds,
      selectedProjectIds,
      selectedPriorityLevels,
      selectedLabelIds,
      selectedStageIds,
      showCompleted,
      onlyOverdue,
      onlyScheduled,
      onlyRecurring,
      onlyDated,
      showReminders,
      detailProjectId,
    ],
  );

  const dataRows = useMemo(() => {
    const filtered = filterTasks(allTasks, listFilters);
    if (dataMode === "task" || showReminders) return filtered;

    const projects = new Map<string, Task[]>();
    filtered.forEach((task) => {
      const projectId = task.project?.id || task.projectId;
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
        name: project?.title || "Untitled project",
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
        workspaceId: project?.workspaceId || first.workspaceId || null,
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
  }, [allTasks, dataMode, listFilters, showReminders]);

  const getGroupLabel = useCallback(
    (task: Task, groupBy: TaskListGroupField): string => {
      if (groupBy === "workspace") return task.workspace?.name || "No workspace";
      if (groupBy === "project") return task.project?.title || "No project";
      if (groupBy === "status") return task.status?.name || "No status";
      if (groupBy === "priority") return task.priorityLevel || "No priority";
      if (groupBy === "stage") return (task.stageId && stageNames[task.stageId]) || "No stage";
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
    },
    [stageNames],
  );

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
  }, [dataRows, groupFields, getGroupLabel]);

  const filteredDataRows = dataRows;
  const dataCount = filteredDataRows.length;

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  }

  if (status === "error") {
    return (
      <div className="flex h-full flex-col p-4">
        <LoadError
          what="your task views"
          error={configQuery.error}
          onRetry={() => configQuery.refetch()}
          retrying={configQuery.isFetching}
        />
      </div>
    );
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
        optionsVisible={optionsVisible}
        onToggleOptions={() => setOptionsVisible((previous) => !previous)}
      />

      {taskViews.length === 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No task views found in config. Create a new view using the + button.
        </div>
      )}

      {syncError && (
        <div className="mx-4 mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {syncError}
        </div>
      )}

      {tasksQuery.isError && tasks && (
        <LoadErrorBanner
          what="tasks"
          error={tasksQuery.error}
          onRetry={() => tasksQuery.refetch()}
          retrying={tasksQuery.isFetching}
          className="mx-4 mt-4"
        />
      )}

      {taskViews.length > 0 && tasksQuery.isError && !tasks && (
        <div className="flex flex-1 flex-col p-4">
          <LoadError
            what="tasks"
            error={tasksQuery.error}
            onRetry={() => tasksQuery.refetch()}
            retrying={tasksQuery.isFetching}
          />
        </div>
      )}

      {taskViews.length > 0 && !(tasksQuery.isError && !tasks) && (
        <>
          <TaskToolbar
            viewMode={viewMode}
            setViewMode={(renderMode) => patchActiveView({ renderMode })}
            groupFields={groupFields}
            setGroupFields={(next) => patchActiveView({ groupFields: next })}
            groupSortDirection={groupSortDirection}
            setGroupSortDirection={(next) => patchActiveView({ groupSortDirection: next })}
            dataMode={dataMode}
            setDataMode={(next) => patchActiveView({ dataMode: next })}
            groupValueOrders={groupValueOrders}
            setGroupValueOrders={(next) => patchActiveView({ groupValueOrders: next })}
            groupOptionsByField={groupOptionsByField}
            workspaces={typedWorkspaces}
            selectedWorkspaceIds={selectedWorkspaceIds}
            setSelectedWorkspaceIds={(next) => patchActiveView({ selectedWorkspaceIds: next })}
            selectedStatusIds={selectedStatusIds}
            setSelectedStatusIds={(next) => patchActiveView({ selectedStatusIds: next })}
            dataCount={dataCount}
            sortBy={sortBy}
            setSortBy={(next) => patchActiveView({ sortBy: next })}
            sortDirection={sortDirection}
            setSortDirection={(next) => patchActiveView({ sortDirection: next })}
            customFields={customFields}
            showReminders={showReminders}
            setShowReminders={(next) => patchActiveView({ showReminders: next })}
          />

          {optionsVisible && (
            <TaskOptionsBar
              showCompleted={showCompleted}
              setShowCompleted={(next) => patchActiveView({ showCompleted: next })}
              onlyOverdue={onlyOverdue}
              setOnlyOverdue={(next) => patchActiveView({ onlyOverdue: next })}
              onlyScheduled={onlyScheduled}
              setOnlyScheduled={(next) => patchActiveView({ onlyScheduled: next })}
              onlyRecurring={onlyRecurring}
              setOnlyRecurring={(next) => patchActiveView({ onlyRecurring: next })}
              onlyDated={onlyDated}
              setOnlyDated={(next) => patchActiveView({ onlyDated: next })}
              projects={typedProjects}
              workspaces={typedWorkspaces}
              selectedProjectIds={selectedProjectIds}
              setSelectedProjectIds={(next) => patchActiveView({ selectedProjectIds: next })}
              selectedPriorityLevels={selectedPriorityLevels}
              setSelectedPriorityLevels={(next) => patchActiveView({ selectedPriorityLevels: next })}
              selectedLabelIds={selectedLabelIds}
              setSelectedLabelIds={(next) => patchActiveView({ selectedLabelIds: next })}
              selectedStageIds={selectedStageIds}
              setSelectedStageIds={(next) => patchActiveView({ selectedStageIds: next })}
            />
          )}

          {detailProjectId ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                Filtered to{" "}
                {typedProjects.find((project) => project.id === detailProjectId)?.title || "this project"}
              </span>
              <Link href={`/projects/${detailProjectId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                Open project
              </Link>
              <button type="button" onClick={closeDetail} className="ml-auto text-xs text-muted-foreground">
                Clear
              </button>
            </div>
          ) : null}

          {dataMode === "task" && !showReminders ? (
            <BulkActionBar
              ids={selectedTaskIds}
              workspaces={typedWorkspaces}
              projects={typedProjects}
              onClear={() => setSelectedTaskIds([])}
            />
          ) : null}

          <div className="flex-1 overflow-auto">
            {typedConfig && viewMode === "list" && (
              <TasksTable
                config={typedConfig}
                groupFields={groupFields}
                groupSortDirection={groupSortDirection}
                groupValueOrders={groupValueOrders}
                selectedWorkspaceIds={selectedWorkspaceIds}
                dataMode={showReminders ? "task" : dataMode}
                sortBy={sortBy}
                sortDirection={sortDirection}
                columnOrder={columnOrder}
                onColumnOrderChange={(next) => patchActiveView({ columnOrder: next })}
                onSelectRow={openRow}
                filters={listFilters}
                stageNames={stageNames}
                stageColors={stageColors}
                selectedIds={selectedTaskIds}
                onSelectedIdsChange={setSelectedTaskIds}
              />
            )}

            {viewMode === "kanban" && (
              <KanbanView
                rows={filteredDataRows}
                dataMode={dataMode}
                onSelectRow={openRow}
                workspaces={typedWorkspaces}
                selectedWorkspaceIds={selectedWorkspaceIds}
                selectedStatusIds={selectedStatusIds}
              />
            )}

            {viewMode === "gantt" && (
              <GanttView
                rows={filteredDataRows}
                dataMode={dataMode}
                onSelectRow={openRow}
              />
            )}
          </div>
        </>
      )}

      {detailTaskId && (
        <EntityDetailPanel
          kind="task"
          id={detailTaskId}
          onClose={closeDetail}
        />
      )}

      {!detailTaskId && detailProjectId && (
        <EntityDetailPanel
          kind="project"
          id={detailProjectId}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

export function TaskHeader() {
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const { data: workspaces } = useWorkspaces();
  const canCreate = ((workspaces ?? []) as Workspace[]).length > 0;

  const openCreate = () => {
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  return (
    <div className="h-14 border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="size-5 rounded-md bg-primary" aria-hidden />
        <h1 className="font-semibold tracking-tight text-foreground">
          Projects &amp; Tasks
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={openCreate}
          disabled={!canCreate}
          title={canCreate ? "Create a task" : "Create a workspace first"}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          <Plus size={14} />
          New task
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
  optionsVisible: boolean;
  onToggleOptions: () => void;
};

export function TaskNavigationBar({
  views,
  activeTaskViewId,
  onSelectView,
  onAddView,
  onDeleteView,
  onRenameView,
  optionsVisible,
  onToggleOptions,
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
    <div className="h-12 border-b border-border flex items-center justify-between px-4">
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
                className="h-7 w-40 rounded-md border border-border bg-input/30 px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
              />
            );
          }

          return (
            <button
              key={view.id}
              className={
                isActive
                  ? "font-medium text-foreground border-b border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }
              onClick={() => onSelectView(view.id)}
            >
              {view.name}
            </button>
          );
        })}

        <div className="flex gap-1">
          <button
            type="button"
            className="p-1 rounded-md bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => (editingViewId ? applyRename() : startRenaming())}
            title={editingViewId ? "Save view name" : "Rename active view"}
            aria-label={editingViewId ? "Save view name" : "Rename active view"}
          >
            <Pencil size={14} />
          </button>

          <button
            type="button"
            className="p-1 rounded-md bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={onAddView}
            title="Add view"
            aria-label="Add view"
          >
            <Plus size={14} />
          </button>

          <button
            type="button"
            className="p-1 rounded-md bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
            onClick={onDeleteView}
            disabled={views.length <= 1}
            title={views.length <= 1 ? "At least one view is required" : "Delete active view"}
            aria-label="Delete active view"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={onToggleOptions}
          aria-pressed={!optionsVisible}
        >
          {optionsVisible ? "Hide options" : "Show options"}
        </button>
      </div>
    </div>
  );
}
