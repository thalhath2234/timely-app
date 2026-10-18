"use client";

import Button from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { FiltersMenu, boardGroupField, TaskListStatusBar, TaskOptionsBar, TaskToolbar, countActiveOptions } from "@/app/_components/_ui/tasks/taskToolbar";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import StaleWorkReview from "@/app/_components/_ui/tasks/staleWorkReview";
import { useProjects } from "@/app/utils/hooks/projects";
import { filterTasks } from "@/app/utils/taskFilters";
import { bucketGroupLabels, queryContext, sortTasks } from "@timely/contract/taskQuery";
import { vocabularyFrom } from "@timely/contract/viewLanguage";
import { todayInZone } from "@timely/contract/workStatus";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import ViewRulesBar, { DescribeViewInput } from "@/app/_components/_ui/tasks/viewRulesBar";
import { useViewPreviewStore } from "@/app/_store/viewPreviewStore";
import { stageColorMap, stageNameMap } from "@/app/utils/stages";
import { MAX_TASK_VIEWS, PREVIEW_VIEW_ID, useTaskViewsState } from "@/app/utils/hooks/taskViews";
import ScreenTip from "@/app/_components/_ui/screenTip";
import { beginOpenMorph, entityTitleKey } from "@/app/utils/titleMorph";
import { runViewTransition } from "@/app/utils/viewTransition";
import { controlClass } from "@/app/_components/_ui/field";

/** Project rows are synthesised from their tasks and carry a prefixed id. */
const PROJECT_ROW_PREFIX = "project-";

/** The `/tasks` query string for an open detail, or "" when none is open. */
function detailHref(taskId: string | null, projectId: string | null) {
  if (taskId) return `taskId=${encodeURIComponent(taskId)}`;
  if (projectId) return `projectId=${encodeURIComponent(projectId)}`;
  return "";
}

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
    activeTaskView,
    setActiveTaskViewId,
    preview,
    openPreview,
    closePreview,
    savePreview,
    saveViewAsNew,
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
    thenSortBy,
    thenSortDirection,
    limit,
    rules,
    ruleMatch,
  } = views;
  const { isLoading, status } = configQuery;
  const { data: workspaces } = useWorkspaces();
  const tasksQuery = useTasks();
  const { data: tasks } = tasksQuery;
  const { data: projects } = useProjects();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [addRequest, setAddRequest] = useState(0);

  const configLoaded = Boolean(typedConfig);
  const typedWorkspaces = useMemo(() => (workspaces ?? []) as Workspace[], [workspaces]);
  const typedProjects = useMemo(() => (projects ?? []) as Project[], [projects]);
  const allTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const customFields = useMemo(
    () => typedConfig?.customFields ?? [],
    [typedConfig?.customFields]
  );
  const stageNames = useMemo(() => stageNameMap(typedProjects), [typedProjects]);
  const stageColors = useMemo(() => stageColorMap(typedProjects), [typedProjects]);
  const { data: providers } = useAgentProviders();
  const aiReady = readyProviders(providers).length > 0;
  const vocab = useMemo(
    () => vocabularyFrom({ workspaces: typedWorkspaces, projects: typedProjects, customFields }),
    [typedWorkspaces, typedProjects, customFields],
  );

  // Search hands over a view read from words: a Preview tab, or a new saved
  // view when the person asked for one ("new view called …").
  const pendingPreview = useViewPreviewStore((state) => state.pending);
  const setPendingPreview = useViewPreviewStore((state) => state.setPending);
  useEffect(() => {
    if (!pendingPreview || !configLoaded) return;
    setPendingPreview(null);
    if (pendingPreview.save && saveViewAsNew(pendingPreview.view)) return;
    openPreview(pendingPreview.view);
  }, [pendingPreview, configLoaded, setPendingPreview, saveViewAsNew, openPreview]);

  // Search can open a saved view by id (?view=…); the param is dropped once
  // the view is active so later view switches are the person's own.
  const viewParam = searchParams.get("view");
  const hasViewParam = Boolean(viewParam && taskViews.some((view) => view.id === viewParam));
  useEffect(() => {
    if (!viewParam || !configLoaded) return;
    // A view deleted since the search ran is dropped from the URL too.
    if (hasViewParam) setActiveTaskViewId(viewParam);
    router.replace("/tasks", { scroll: false });
  }, [viewParam, hasViewParam, configLoaded, setActiveTaskViewId, router]);

  // The open row lives in the URL so an @mention can link straight to it.
  // Clicks set it locally first, inside a view transition (router updates
  // never start one), and the URL catches up right after that commit.
  const urlDetail = detailHref(searchParams.get("taskId"), searchParams.get("projectId"));
  const [detail, setDetail] = useState(urlDetail);
  const [syncedUrlDetail, setSyncedUrlDetail] = useState(urlDetail);
  if (urlDetail !== syncedUrlDetail) {
    // Back/forward or an @mention link changed the URL.
    setSyncedUrlDetail(urlDetail);
    setDetail(urlDetail);
  }
  const pushedDetail = useRef(urlDetail);
  useEffect(() => {
    if (detail === syncedUrlDetail) {
      pushedDetail.current = detail;
      return;
    }
    if (detail === pushedDetail.current) return;
    pushedDetail.current = detail;
    router.push(detail ? `/tasks?${detail}` : "/tasks", { scroll: false });
  }, [detail, syncedUrlDetail, router]);
  const detailParams = new URLSearchParams(detail);
  const detailTaskId = detailParams.get("taskId");
  const detailProjectId = detailParams.get("projectId");

  const openRow = useCallback((row: Task) => {
    const isProject = row.id.startsWith(PROJECT_ROW_PREFIX);
    const id = isProject ? row.id.slice(PROJECT_ROW_PREFIX.length) : row.id;
    beginOpenMorph(entityTitleKey(isProject ? "project" : "task", id));
    runViewTransition(() => setDetail(isProject ? detailHref(null, id) : detailHref(id, null)));
  }, []);

  const closeDetail = useCallback(() => runViewTransition(() => setDetail("")), []);

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
      rules,
      ruleMatch,
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
      rules,
      ruleMatch,
      detailProjectId,
    ],
  );

  const dataRows = useMemo(() => {
    const filtered = filterTasks(allTasks, listFilters, typedConfig?.workingHours?.timezone);
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
        kind: "task" as const,
        project,
        workspace: first.workspace,
        status: first.status,
        customFieldValues: [],
        labelIds: [],
        labels: [],
      } as Task;
    });
  }, [allTasks, dataMode, listFilters, showReminders, typedConfig?.workingHours?.timezone]);

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
        if (typeof value.boolValue === "boolean") return value.boolValue ? "Yes" : "No";
        return "-";
      }
      return "No group";
    },
    [stageNames],
  );

  const bucketCtx = useMemo(
    () => queryContext(allTasks, typedConfig?.workingHours?.timezone),
    [allTasks, typedConfig?.workingHours?.timezone],
  );

  const groupOptionsByField = useMemo(() => {
    const options: Record<string, string[]> = {};
    groupFields.forEach((field) => {
      const values = new Set<string>();
      dataRows.forEach((row) => {
        const buckets = bucketGroupLabels(row, field, bucketCtx);
        if (buckets) buckets.forEach((label) => values.add(label));
        else values.add(getGroupLabel(row, field));
      });
      options[field] = Array.from(values).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
      );
    });
    return options;
  }, [dataRows, groupFields, getGroupLabel, bucketCtx]);

  // Board and timeline get the view's sort and limit too; the list sorts itself.
  const filteredDataRows = useMemo(() => {
    if (viewMode === "list") return dataRows;
    const ctx = queryContext(allTasks, typedConfig?.workingHours?.timezone, new Date(), stageNames);
    const sorted = sortTasks(dataRows, { sortBy, sortDirection, thenSortBy, thenSortDirection }, ctx);
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  }, [viewMode, dataRows, allTasks, typedConfig?.workingHours?.timezone, stageNames, sortBy, sortDirection, thenSortBy, thenSortDirection, limit]);
  const dataCount = limit && limit > 0 ? Math.min(limit, dataRows.length) : dataRows.length;
  const headerTaskCount = useMemo(
    () => filterTasks(allTasks, { ...listFilters, showReminders: false }, typedConfig?.workingHours?.timezone).length,
    [allTasks, listFilters, typedConfig?.workingHours?.timezone],
  );
  const headerProjectCount = useMemo(() => {
    const ids = new Set<string>();
    for (const task of filterTasks(allTasks, listFilters, typedConfig?.workingHours?.timezone)) {
      const projectId = task.project?.id || task.projectId;
      if (projectId) ids.add(projectId);
    }
    return ids.size;
  }, [allTasks, listFilters, typedConfig?.workingHours?.timezone]);

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
      <TaskHeader taskCount={headerTaskCount} projectCount={headerProjectCount} />

      <ScreenTip screen="tasks" className="mx-5 mt-3" />

      <TaskNavigationBar
        views={preview ? [...taskViews, preview] : taskViews}
        activeTaskViewId={activeTaskViewId}
        onSelectView={setActiveTaskViewId}
        onAddView={addNewView}
        onDeleteView={deleteActiveView}
        onRenameView={renameView}
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

      {tasks && <StaleWorkReview />}

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
            thenSortBy={thenSortBy}
            thenSortDirection={thenSortDirection}
            setThenSort={(by, direction) => patchActiveView({ thenSortBy: by, thenSortDirection: direction })}
            limit={limit}
            setLimit={(next) => patchActiveView({ limit: next })}
            search={
              <DescribeViewInput
                view={activeTaskView}
                vocab={vocab}
                today={todayInZone(typedConfig?.workingHours?.timezone)}
                aiReady={aiReady}
                onPatch={patchActiveView}
                className="w-56 focus-within:w-72"
              />
            }
            filters={
              <FiltersMenu
                count={countActiveOptions({
                  showCompleted,
                  onlyOverdue,
                  onlyScheduled,
                  onlyRecurring,
                  onlyDated,
                  selectedProjectIds,
                  selectedPriorityLevels,
                  selectedLabelIds,
                  selectedStageIds,
                })}
              >
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
                layout="panel"
                  footer={
                    <>
                      <span className="text-xs text-muted-foreground">Need another field? Add a rule.</span>
                      <Button size="sm" variant="ghost" onClick={() => setAddRequest((n) => n + 1)}>
                        <Plus aria-hidden="true" />
                        Add filter
                      </Button>
                    </>
                  }
                />
              </FiltersMenu>
            }
          />


          <ViewRulesBar
            view={activeTaskView}
            vocab={vocab}
            customFields={customFields}
            today={todayInZone(typedConfig?.workingHours?.timezone)}
            aiReady={aiReady}
            onPatch={patchActiveView}
            describe={false}
            addRequest={addRequest}
            preview={
              preview
                ? { onSave: () => void savePreview(), onClose: closePreview, full: taskViews.length >= MAX_TASK_VIEWS }
                : undefined
            }
          />

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
                emptyText={allTasks.length ? "Nothing matches this view. Change or remove a filter above." : undefined}
                thenSortBy={thenSortBy}
                thenSortDirection={thenSortDirection}
                limit={limit}
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
                selectedPriorityLevels={selectedPriorityLevels}
                groupField={boardGroupField(groupFields)}
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

          <TaskListStatusBar
            shown={dataCount}
            total={showReminders || dataMode !== "task" ? dataCount : headerTaskCount}
            synced={!syncError}
            noun={showReminders ? "reminder" : dataMode === "project" ? "project" : "task"}
          />
        </>
      )}

      {detailTaskId ? (
        <EntityDetailPanel
          key={`task:${detailTaskId}`}
          kind="task"
          id={detailTaskId}
          onClose={closeDetail}
        />
      ) : null}
      {!detailTaskId && detailProjectId ? (
        <EntityDetailPanel
          key={`project:${detailProjectId}`}
          kind="project"
          id={detailProjectId}
          onClose={closeDetail}
        />
      ) : null}
    </div>
  );
}

function TaskHeader({
  taskCount = 0,
  projectCount = 0,
}: {
  taskCount?: number;
  projectCount?: number;
}) {
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const { data: workspaces } = useWorkspaces();
  const canCreate = ((workspaces ?? []) as Workspace[]).length > 0;

  const openCreate = () => {
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  return (
    <PageHeader
      title="Tasks"
      bordered
      badge={
        <PageBadge>
          {taskCount} task{taskCount === 1 ? "" : "s"} · {projectCount} project{projectCount === 1 ? "" : "s"}
        </PageBadge>
      }
      actions={
        <>
          <Button
            onClick={openCreate}
            disabled={!canCreate}
            title={canCreate ? "Create a task" : "Create a workspace first"}
            leading={<Plus />}
          >
            New task
          </Button>
        </>
      }
    />
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

function TaskNavigationBar({
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
    <div className="flex h-11 items-end border-b border-border px-6">
      <div className="flex items-end gap-5 text-xs">
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
                className={controlClass("sm", "w-40")}
              />
            );
          }

          return (
            <button
              key={view.id}
              className={
                isActive
                  ? "flex items-center gap-1.5 border-b-2 border-primary pb-2.5 font-semibold text-primary"
                  : "border-b-2 border-transparent pb-2.5 font-medium text-muted-foreground hover:text-foreground"
              }
              onClick={() => onSelectView(view.id)}
            >
              {view.id === PREVIEW_VIEW_ID ? <span className="font-normal text-muted-foreground">Preview:</span> : null}
              {view.name}
              {isActive ? (
                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              ) : null}
            </button>
          );
        })}

        <div className="flex gap-0.5 pb-2.5 text-muted-foreground">
          <button
            type="button"
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => (editingViewId ? applyRename() : startRenaming())}
            title={editingViewId ? "Save view name" : "Rename active view"}
            aria-label={editingViewId ? "Save view name" : "Rename active view"}
          >
            <Pencil size={12} />
          </button>

          <button
            type="button"
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            onClick={onAddView}
            title="Add view"
            aria-label="Add view"
          >
            <Plus size={12} />
          </button>

          <button
            type="button"
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            onClick={onDeleteView}
            disabled={views.length <= 1}
            title={activeTaskViewId === PREVIEW_VIEW_ID ? "Close preview" : views.length <= 1 ? "At least one view is required" : "Delete active view"}
            aria-label={activeTaskViewId === PREVIEW_VIEW_ID ? "Close preview" : "Delete active view"}
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
