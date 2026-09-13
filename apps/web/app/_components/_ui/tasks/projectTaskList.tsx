"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Project, Task, Workspace } from "@/app/_types/types";
import BulkActionBar from "@/app/_components/_ui/tasks/bulkActionBar";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import GanttView from "@/app/_components/_ui/tasks/ganttView";
import KanbanView from "@/app/_components/_ui/tasks/kanbanView";
import { TaskOptionsBar, TaskToolbar } from "@/app/_components/_ui/tasks/taskToolbar";
import TasksTable from "@/app/_components/_ui/tasks/tasktable";
import LoadError from "@/app/_components/_ui/loadError";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { usePersistedProjectTaskView } from "@/app/utils/hooks/projectTaskView";
import { useTasks } from "@/app/utils/hooks/tasks";
import { filterTasks } from "@/app/utils/taskFilters";
import { stageNameMap } from "@/app/utils/stages";

export default function ProjectTaskList({
  project,
  workspace,
}: {
  project: Project;
  workspace?: Workspace;
}) {
  const tasksQuery = useTasks();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const view = usePersistedProjectTaskView(project);
  const {
    configQuery,
    typedConfig,
    viewMode,
    setViewMode,
    groupFields,
    setGroupFields,
    groupSortDirection,
    setGroupSortDirection,
    dataMode,
    setDataMode,
    selectedStatusIds,
    setSelectedStatusIds,
    selectedPriorityLevels,
    setSelectedPriorityLevels,
    selectedLabelIds,
    setSelectedLabelIds,
    selectedStageIds,
    setSelectedStageIds,
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
    showReminders,
    setShowReminders,
    columnOrder,
    setColumnOrder,
    groupValueOrders,
    setGroupValueOrders,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    optionsVisible,
    setOptionsVisible,
    defaultGroups,
    syncError,
  } = view;

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const openTask = useEntityDetailStore((state) => state.openTask);

  const allTasks = useMemo(() => (tasksQuery.data ?? []) as Task[], [tasksQuery.data]);
  const customFields = useMemo(
    () => typedConfig?.customFields ?? [],
    [typedConfig?.customFields],
  );
  const scopedWorkspaces = useMemo(
    () => (workspace ? [workspace] : []),
    [workspace],
  );
  const selectedWorkspaceIds = useMemo(
    () => (project.workspaceId ? [project.workspaceId] : []),
    [project.workspaceId],
  );
  const stageNames = useMemo(() => stageNameMap([project]), [project]);

  const listFilters = useMemo(
    () => ({
      workspaceIds: [] as string[],
      statusIds: selectedStatusIds,
      projectIds: [project.id],
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
      project.id,
      selectedStatusIds,
      selectedPriorityLevels,
      selectedLabelIds,
      selectedStageIds,
      showCompleted,
      onlyOverdue,
      onlyScheduled,
      onlyRecurring,
      onlyDated,
      showReminders,
    ],
  );

  const dataRows = useMemo(
    () => filterTasks(allTasks, listFilters),
    [allTasks, listFilters],
  );

  const getGroupLabel = useCallback(
    (task: Task, groupBy: typeof groupFields[number]): string => {
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
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      );
    });
    return options;
  }, [dataRows, groupFields, getGroupLabel]);

  const openRow = useCallback((row: Task) => {
    openTask(row.id);
  }, [openTask]);

  const openCreate = () => {
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  if (configQuery.isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading tasks…</p>;
  }

  if (configQuery.status === "error") {
    return (
      <div className="flex h-full flex-col p-4">
        <LoadError
          what="task views"
          error={configQuery.error}
          onRetry={() => configQuery.refetch()}
          retrying={configQuery.isFetching}
        />
      </div>
    );
  }

  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <div className="flex h-full flex-col p-4">
        <LoadError
          what="tasks"
          error={tasksQuery.error}
          onRetry={() => tasksQuery.refetch()}
          retrying={tasksQuery.isFetching}
        />
      </div>
    );
  }

  if (!typedConfig) {
    return <p className="p-4 text-sm text-muted-foreground">Loading tasks…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setOptionsVisible((previous) => !previous)}
          aria-pressed={!optionsVisible}
        >
          {optionsVisible ? "Hide options" : "Show options"}
        </button>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={14} />
          New task
        </button>
      </div>

      {syncError ? (
        <div className="mx-4 mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {syncError}
        </div>
      ) : null}

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
        workspaces={scopedWorkspaces}
        selectedWorkspaceIds={selectedWorkspaceIds}
        setSelectedWorkspaceIds={() => undefined}
        selectedStatusIds={selectedStatusIds}
        setSelectedStatusIds={setSelectedStatusIds}
        dataCount={dataRows.length}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortDirection={sortDirection}
        setSortDirection={setSortDirection}
        customFields={customFields}
        showReminders={showReminders}
        setShowReminders={setShowReminders}
        scope="project"
        defaultGroupFields={defaultGroups}
      />

      {optionsVisible ? (
        <TaskOptionsBar
          showCompleted={showCompleted}
          setShowCompleted={setShowCompleted}
          onlyOverdue={onlyOverdue}
          setOnlyOverdue={setOnlyOverdue}
          onlyScheduled={onlyScheduled}
          setOnlyScheduled={setOnlyScheduled}
          onlyRecurring={onlyRecurring}
          setOnlyRecurring={setOnlyRecurring}
          onlyDated={onlyDated}
          setOnlyDated={setOnlyDated}
          projects={[project]}
          workspaces={scopedWorkspaces}
          selectedProjectIds={[project.id]}
          setSelectedProjectIds={() => undefined}
          selectedPriorityLevels={selectedPriorityLevels}
          setSelectedPriorityLevels={setSelectedPriorityLevels}
          selectedLabelIds={selectedLabelIds}
          setSelectedLabelIds={setSelectedLabelIds}
          selectedStageIds={selectedStageIds}
          setSelectedStageIds={setSelectedStageIds}
          scope="project"
        />
      ) : null}

      {dataMode === "task" && !showReminders ? (
        <BulkActionBar
          ids={selectedTaskIds}
          workspaces={scopedWorkspaces}
          projects={[project]}
          onClear={() => setSelectedTaskIds([])}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {viewMode === "list" ? (
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
            onColumnOrderChange={setColumnOrder}
            onSelectRow={openRow}
            filters={listFilters}
            stageNames={stageNames}
            selectedIds={selectedTaskIds}
            onSelectedIdsChange={setSelectedTaskIds}
          />
        ) : null}

        {viewMode === "kanban" ? (
          <KanbanView
            rows={dataRows}
            dataMode={dataMode}
            onSelectRow={openRow}
            workspaces={scopedWorkspaces}
            selectedWorkspaceIds={selectedWorkspaceIds}
            selectedStatusIds={selectedStatusIds}
          />
        ) : null}

        {viewMode === "gantt" ? (
          <GanttView rows={dataRows} dataMode={dataMode} onSelectRow={openRow} />
        ) : null}
      </div>

    </div>
  );
}
