import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, RefreshControl, ScrollView, SectionList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ListTodo, SlidersHorizontal } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar from "../../../components/tasks/TaskFilterBar";
import StaleWorkCard from "../../../components/tasks/StaleWorkCard";
import ScreenTip from "../../../components/ui/ScreenTip";
import MobileKanban, { type KanbanColumn, kanbanColumns } from "../../../components/tasks/MobileKanban";
import TaskFiltersSheet from "../../../components/tasks/TaskFiltersSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { Dot } from "../../../components/ui/primitives";
import {
  useBulkUpdateTasks,
  useDeleteTask,
  useProjectsQuery,
  useSaveTask,
  useTasksQuery,
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { addDays, formatShortDate, PRIORITY_META, startOfDay, toDateInputValue } from "../../../lib/format";
import { normalizePriority, PRIORITIES } from "../../../lib/priority";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { bulkUndoSnapshot, labelIdsWithNamed, mergeLabelsByName, type BulkUndoField, type NamedLabelGroup } from "@timely/contract/bulkEdit";
import { resolvedColor } from "../../../lib/entityColor";
import {
  mergeStatusesByName,
  statusForWorkspace,
  statusNameKey,
  statusPatch,
} from "../../../lib/status";
import { showUndoToast } from "../../../lib/toast";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import {
  filterTasks,
  filtersFromView,
  isReminderTask,
} from "../../../lib/taskFilters";
import {
  customFieldGroupLabel,
  defaultNativeTaskViews,
  useNativeTaskViews,
} from "../../../lib/nativeTaskViews";
import type { Task, TaskListGroupField, TaskViewConfig } from "../../../lib/types";
import {
  BUCKET_GROUP_FIELDS,
  bucketGroupLabels,
  bucketGroupRank,
  queryContext,
  sortTasks,
  viewLimit,
  viewSort,
  type QueryContext,
} from "@timely/contract/taskQuery";
import { vocabularyFrom } from "@timely/contract/viewLanguage";
import ViewRulesBar from "../../../components/tasks/ViewRulesBar";
import { useViewPreviewStore } from "../../../lib/viewPreviewStore";
import type { UpdateTaskPayload } from "../../../lib/api/tasks";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { useFabScrollInset } from "../../../components/ui/FloatingTabBar";

function groupField(view?: TaskViewConfig): TaskListGroupField | undefined {
  // The phone board groups by status, priority, workspace, project or stage.
  if (view?.renderMode === "kanban") {
    const first = view.groupFields?.[0];
    return first && !BUCKET_GROUP_FIELDS.has(first) ? first : "status";
  }
  return view?.groupFields?.[0];
}

function groupValue(task: Task, field: TaskListGroupField, stageNames: Record<string, string>) {
  if (field === "status") return statusNameKey(task.status?.name) || "none";
  if (field === "priority") return normalizePriority(task.priorityLevel) || "none";
  if (field === "workspace") return task.workspaceId || "none";
  if (field === "project") return task.projectId || "none";
  if (field === "stage") return task.stageId || "none";
  if (field?.startsWith("cf:")) {
    const fieldId = field.slice(3);
    return `cf:${fieldId}:${customFieldGroupLabel(task, fieldId)}`;
  }
  return "none";
}

function groupValueTitle(task: Task, field: TaskListGroupField, stageNames: Record<string, string>) {
  if (field === "status") return task.status?.name ?? "No status";
  if (field === "priority") return normalizePriority(task.priorityLevel) || "No priority";
  if (field === "workspace") return task.workspace?.name ?? "No workspace";
  if (field === "project") return task.project?.title ?? "No project";
  if (field === "stage") return (task.stageId && stageNames[task.stageId]) || "No stage";
  if (field?.startsWith("cf:")) return customFieldGroupLabel(task, field.slice(3));
  return "Other";
}

function groupFields(view?: TaskViewConfig): TaskListGroupField[] {
  if (view?.renderMode === "kanban") return [groupField(view) ?? "status"];
  return view?.groupFields?.length ? view.groupFields.slice(0, 3) : ["project"];
}

/**
 * Every group a task sits in, as key and title: one, or several when it
 * carries several labels. Dates, labels, effort, done and repeating are
 * bucketed by the shared engine so the phone and web show the same groups.
 */
function taskGroups(task: Task, view: TaskViewConfig | undefined, stageNames: Record<string, string>, ctx: QueryContext) {
  let parts: { key: string; title: string }[] = [{ key: "", title: "" }];
  for (const field of groupFields(view)) {
    const values = bucketGroupLabels(task, field, ctx)?.map((label) => ({ key: label, title: label })) ?? [
      { key: groupValue(task, field, stageNames), title: groupValueTitle(task, field, stageNames) },
    ];
    parts = parts.flatMap((part) =>
      values.map((value) => ({
        key: `${part.key}|${field}:${value.key}`,
        title: part.title ? `${part.title} › ${value.title}` : value.title,
      })),
    );
  }
  return parts;
}

/** The group's own colour, as the desktop list and board show it; groups
 * like "No project" stay neutral (null). */
function groupColor(task: Task, view: TaskViewConfig | undefined, stageColors: Record<string, string>) {
  const field = groupField(view);
  if (field === "status") return task.status?.color ?? null;
  if (field === "priority") return PRIORITY_META[normalizePriority(task.priorityLevel)]?.color ?? null;
  if (field === "workspace") {
    const id = task.workspace?.id ?? task.workspaceId;
    return id ? resolvedColor(task.workspace?.color, id) : null;
  }
  if (field === "project") {
    const id = task.project?.id ?? task.projectId;
    return id ? resolvedColor(task.project?.color, id) : null;
  }
  if (field === "stage") return task.stageId ? stageColors[task.stageId] ?? resolvedColor(task.stage?.color, task.stageId) : null;
  return null;
}

function viewHasCustomFilters(view?: TaskViewConfig) {
  if (!view) return false;
  return Boolean(
    view.rules?.length ||
      view.selectedWorkspaceIds?.length ||
      view.selectedStatusIds?.length ||
      view.selectedProjectIds?.length ||
      view.selectedPriorityLevels?.length ||
      view.selectedLabelIds?.length ||
      view.selectedStageIds?.length ||
      view.onlyOverdue ||
      view.onlyScheduled ||
      view.onlyRecurring ||
      view.onlyDated ||
      view.showCompleted === false,
  );
}

export default function TasksScreen() {
  const fabInset = useFabScrollInset();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; view?: string }>();
  const routeProjectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const viewParam = typeof params.view === "string" && params.view ? params.view : undefined;
  const tasksQ = useTasksQuery();
  const spacesQ = useWorkspacesQuery();
  const nativeViews = useNativeTaskViews();
  const projects = useProjectsQuery().data ?? [];
  const save = useSaveTask();
  const bulk = useBulkUpdateTasks();
  const remove = useDeleteTask();
  const tasks = tasksQ.data ?? [];
  const workingHoursZone = useWorkingHoursZone();
  const workspaces = spacesQ.data ?? [];
  const networkCopy = needsNetworkCopy(tasksQ);
  const views = nativeViews.views;
  // A view read from words in Search shows as an unsaved Preview tab.
  const preview = useViewPreviewStore((state) => state.preview);
  const setPreview = useViewPreviewStore((state) => state.setPreview);
  const patchPreview = useViewPreviewStore((state) => state.patchPreview);
  const activeView = preview ?? nativeViews.activeView;
  const activeViewId = preview ? preview.id : nativeViews.activeViewId;
  const patchView = preview ? patchPreview : nativeViews.patchActiveView;
  const pendingSave = useViewPreviewStore((state) => state.pendingSave);
  const setPendingSave = useViewPreviewStore((state) => state.setPendingSave);
  const { saveViewAsNew } = nativeViews;
  useEffect(() => {
    if (!pendingSave || !nativeViews.ready) return;
    setPendingSave(null);
    if (saveViewAsNew(pendingSave)) setPreview(null);
    else setPreview(pendingSave);
  }, [pendingSave, nativeViews.ready, setPendingSave, saveViewAsNew, setPreview]);
  // Search and the assistant open a saved view by id (?view=…). A view the
  // assistant just made may not be here yet, so the views are fetched once
  // more before the param is dropped.
  const { ready: viewsReady, syncing: viewsSyncing, setActiveId: setNativeActiveId, refresh: refreshViews } = nativeViews;
  const refreshedFor = useRef("");
  useEffect(() => {
    if (!viewParam || !viewsReady) return;
    if (views.some((view) => view.id === viewParam)) {
      setNativeActiveId(viewParam);
      router.setParams({ view: undefined });
      return;
    }
    if (viewsSyncing) return;
    if (refreshedFor.current !== viewParam) {
      refreshedFor.current = viewParam;
      void refreshViews();
      return;
    }
    router.setParams({ view: undefined });
  }, [viewParam, viewsReady, viewsSyncing, views, setNativeActiveId, refreshViews, router]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDeleteView, setConfirmDeleteView] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState<
    null | "menu" | "status" | "priority" | "project" | "label" | "deadline"
  >(null);

  const projectId = routeProjectId;
  const project = projects.find((item) => item.id === projectId);
  const workspaceFilter = activeView?.selectedWorkspaceIds?.[0] ?? null;
  const customFields = useMemo(() => {
    const seen = new Set<string>();
    return workspaces.flatMap((space) => space.customFields ?? []).filter((field) => {
      if (seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
  }, [workspaces]);
  const stageNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const item of projects) {
      for (const stage of item.stages ?? []) names[stage.id] = stage.name;
    }
    return names;
  }, [projects]);
  const stageColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of projects) {
      for (const stage of item.stages ?? []) out[stage.id] = resolvedColor(stage.color, stage.id);
    }
    return out;
  }, [projects]);

  const queryCtx = useMemo(
    () => queryContext(tasks, workingHoursZone, new Date(), stageNames),
    [tasks, workingHoursZone, stageNames],
  );
  const visible = useMemo(() => {
    if (!activeView || activeView.dataMode === "project") return [];
    const rows = sortTasks(
      filterTasks(tasks, filtersFromView(activeView), workingHoursZone).filter((task) =>
        projectId ? task.projectId === projectId : true,
      ),
      viewSort(activeView),
      queryCtx,
    );
    const limit = viewLimit(activeView);
    return limit ? rows.slice(0, limit) : rows;
  }, [tasks, projectId, activeView, workingHoursZone, queryCtx]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; rank?: number; color: string | null; tasks: Task[] }>();
    const first = groupField(activeView) ?? "project";
    for (const task of visible) {
      for (const group of taskGroups(task, activeView, stageNames, queryCtx)) {
        if (!map.has(group.key)) {
          const firstTitle = group.title.split(" › ")[0];
          map.set(group.key, {
            title: group.title,
            rank: bucketGroupRank(first, firstTitle),
            color: BUCKET_GROUP_FIELDS.has(first) ? null : groupColor(task, activeView, stageColors),
            tasks: [],
          });
        }
        map.get(group.key)!.tasks.push(task);
      }
    }
    const rows = [...map.values()];
    const ordered = activeView?.groupValueOrders?.[first];
    rows.sort((a, b) => {
      if (ordered?.length) {
        const left = ordered.indexOf(a.title);
        const right = ordered.indexOf(b.title);
        if (left !== -1 || right !== -1) {
          return (left === -1 ? ordered.length : left) - (right === -1 ? ordered.length : right);
        }
      }
      const cmp = a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank ? a.rank - b.rank : a.title.localeCompare(b.title);
      return activeView?.groupSortDirection === "desc" ? -cmp : cmp;
    });
    return rows;
  }, [visible, activeView, stageNames, stageColors, queryCtx]);
  const vocab = useMemo(
    () => vocabularyFrom({ workspaces, projects, customFields }),
    [workspaces, projects, customFields],
  );

  const sections = useMemo(
    () => groups.map((group) => ({ title: group.title, color: group.color, data: group.tasks })),
    [groups],
  );

  const projectRows = useMemo(() => {
    if (activeView?.dataMode !== "project") return [];
    const wanted = new Set(activeView.selectedWorkspaceIds ?? []);
    return projects
      .filter((item) => {
        if (wanted.size > 0 && !wanted.has(item.workspaceId)) return false;
        if (projectId && item.id !== projectId) return false;
        return true;
      })
      .map((item) => {
        const inProject = tasks.filter(
          (task) => task.projectId === item.id && !isReminderTask(task) && task.kind !== "inbox",
        );
        return {
          ...item,
          scheduledCount: inProject.filter((task) => Boolean(task.scheduledOn) && !task.completedAt).length,
          openCount: inProject.filter((task) => !task.completedAt).length,
        };
      });
  }, [activeView, projects, projectId, tasks]);

  // Project cards follow the view's workspace grouping, as on the desktop;
  // the other group fields describe tasks, not projects.
  const projectsByWorkspace = Boolean(activeView?.groupFields?.includes("workspace"));
  const projectSections = useMemo(() => {
    if (!projectsByWorkspace) return projectRows.length ? [{ key: "all", title: "", color: null as string | null, data: projectRows }] : [];
    const byId = new Map(workspaces.map((space) => [space.id, space]));
    const map = new Map<string, { key: string; title: string; color: string | null; data: typeof projectRows }>();
    for (const row of projectRows) {
      const space = row.workspaceId ? byId.get(row.workspaceId) : undefined;
      const key = space?.id ?? "none";
      if (!map.has(key)) {
        map.set(key, {
          key,
          title: space?.name || "No workspace",
          color: space ? resolvedColor(space.color, space.id) : null,
          data: [],
        });
      }
      map.get(key)!.data.push(row);
    }
    const desc = activeView?.groupSortDirection === "desc";
    return [...map.values()].sort((a, b) => (desc ? -1 : 1) * a.title.localeCompare(b.title));
  }, [projectRows, projectsByWorkspace, workspaces, activeView?.groupSortDirection]);
  const workspaceById = useMemo(() => new Map(workspaces.map((space) => [space.id, space])), [workspaces]);

  useAssistantScreen([
    contextChip("task-view", activeView?.name || "Task view", { filters: activeView ? filtersFromView(activeView) : {}, projectId, dataMode: activeView?.dataMode, scope: selectedIds.length ? "selected" : "all-filtered-matches", taskIds: selectedIds.length ? selectedIds : visible.map((task) => task.id), projectIds: activeView?.dataMode === "project" ? projectRows.map((project) => project.id) : undefined }),
    ...(projectId ? [contextChip("project", project?.title || "Project", projectId)] : []),
    ...(workspaceFilter ? [contextChip("workspace", "Workspace", workspaceFilter)] : []),
  ]);

  const selecting = selectedIds.length > 0;
  const statuses = useMemo(
    () =>
      workspaces
        .filter((space) => (workspaceFilter ? space.id === workspaceFilter : true))
        .flatMap((space) => space.status ?? []),
    [workspaces, workspaceFilter],
  );
  const statusGroups = useMemo(() => mergeStatusesByName(statuses), [statuses]);
  const labels = useMemo(
    () =>
      workspaces
        .filter((space) => (workspaceFilter ? space.id === workspaceFilter : true))
        .flatMap((space) => space.lables ?? []),
    [workspaces, workspaceFilter],
  );
  const labelGroups = useMemo(() => mergeLabelsByName(labels), [labels]);
  const stages = useMemo(
    () =>
      projects
        .filter((item) => (workspaceFilter ? item.workspaceId === workspaceFilter : true))
        .flatMap((item) => item.stages ?? []),
    [projects, workspaceFilter],
  );
  const boardMode = activeView?.renderMode === "kanban" && activeView.dataMode !== "project";
  const boardCols = useMemo(() => kanbanColumns(visible, statusGroups, groupField(activeView) ?? "status", activeView?.selectedStatusIds ?? [], activeView?.selectedPriorityLevels ?? []), [visible, statusGroups, activeView]);

  const toggleSelect = useCallback((task: Task) => {
    setSelectedIds((current) =>
      current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id],
    );
  }, []);

  // Undo puts back each task's own previous value rather than blanking the
  // selection.
  function applyBulk(update: UpdateTaskPayload, fields: BulkUndoField[], message: string) {
    const ids = selectedIds;
    const before = bulkUndoSnapshot(tasks.filter((task) => ids.includes(task.id)), fields);
    bulk.mutate({ ids, update });
    showUndoToast(message, () => {
      before.forEach((previous, id) => save.mutate({ id, data: previous }));
    });
    setSelectedIds([]);
    setBulkPicker(null);
  }

  // Adds the label to each task's own labels, using the label of that name in
  // the task's workspace; tasks whose workspace has none are skipped.
  function applyLabel(group: NamedLabelGroup) {
    const selected = tasks.filter((task) => selectedIds.includes(task.id));
    const before = bulkUndoSnapshot(selected, ["labelIds"]);
    let skipped = 0;
    selected.forEach((task) => {
      const labelIds = labelIdsWithNamed(task, group);
      if (!labelIds) {
        skipped += 1;
        before.delete(task.id);
        return;
      }
      save.mutate({ id: task.id, data: { labelIds } });
    });
    showUndoToast(
      skipped ? `Labeled ${group.name} · skipped ${skipped} without that label` : `Labeled ${group.name}`,
      () => before.forEach((previous, id) => save.mutate({ id, data: previous })),
    );
    setSelectedIds([]);
    setBulkPicker(null);
  }

  // A board drop. Same rules and copy as the desktop board: no-op when nothing
  // changes, "Moved to X" with Undo otherwise, and never a status from
  // another workspace.
  function moveOnBoard(task: Task, column: KanbanColumn) {
    const field = groupField(activeView) ?? "status";
    if (field === "status") {
      const group = statusGroups.find((item) => item.key === column.key);
      if (!group) return;
      const status = task.workspaceId ? group.statuses.find((item) => item.workspaceId === task.workspaceId) : group.statuses[0];
      if (!status) {
        showUndoToast(`${task.workspace?.name ?? "This workspace"} has no "${group.name}" status`);
        return;
      }
      if ((task.statusId ?? task.status?.id) === status.id) return;
      const patch = statusPatch(status, task.completedAt);
      const previous = { statusId: task.statusId ?? task.status?.id ?? "", completedAt: task.completedAt ?? "" };
      save.mutate({ id: task.id, data: patch, optimistic: { status } });
      showUndoToast(`Moved to ${status.name}`, () => save.mutate({ id: task.id, data: previous, optimistic: { status: task.status } }));
      return;
    }
    const key = field === "priority" ? "priorityLevel" : field === "workspace" ? "workspaceId" : field === "project" ? "projectId" : field === "stage" ? "stageId" : null;
    if (!key) return;
    const next = column.key === "none" ? "" : column.key;
    const previous = String(task[key] ?? "");
    if (next === previous) return;
    save.mutate({ id: task.id, data: { [key]: next } });
    showUndoToast(`Moved to ${column.title}`, () => save.mutate({ id: task.id, data: { [key]: previous } }));
  }

  function applyNamedStatus(nameKey: string) {
    const group = statusGroups.find((item) => item.key === nameKey);
    if (!group) return;
    const ids = selectedIds;
    const previous = ids.map((id) => {
      const task = tasks.find((item) => item.id === id);
      return { id, statusId: task?.statusId ?? null, completedAt: task?.completedAt ?? null };
    });
    ids.forEach((id) => {
      const task = tasks.find((item) => item.id === id);
      if (!task) return;
      const status = statusForWorkspace(group, task.workspaceId);
      if (!status) return;
      save.mutate({ id, data: statusPatch(status, task.completedAt) });
    });
    showUndoToast("Status updated", () => {
      previous.forEach((item) =>
        save.mutate({ id: item.id, data: { statusId: item.statusId, completedAt: item.completedAt } }),
      );
    });
    setSelectedIds([]);
    setBulkPicker(null);
  }

  function selectView(id: string) {
    setSelectedIds((current) => (current.length > 0 ? [] : current));
    if (preview && id === preview.id) return;
    setPreview(null);
    nativeViews.setActiveId(id);
  }

  const toggleComplete = useCallback((task: Task) => {
    save.mutate({
      id: task.id,
      data: { completedAt: task.completedAt ? "" : new Date().toISOString() },
    });
  }, [save]);

  const openCount = useMemo(() => visible.filter((task) => !task.completedAt).length, [visible]);
  // One date for the whole list: cards take it as a prop instead of each
  // subscribing to the Working hours config.
  const today = todayInZone(workingHoursZone);
  const overdueCount = useMemo(
    () => visible.filter((task) => isOverdue(task, today)).length,
    [visible, today],
  );
  const filtersOn = viewHasCustomFilters(activeView);
  const listRefreshing = tasksQ.isRefetching && !tasksQ.isPending;
  const refreshControl = (
    <RefreshControl
      refreshing={listRefreshing}
      onRefresh={() => void tasksQ.refetch()}
      tintColor={colors.primary}
    />
  );

  const renderTask = useCallback(
    ({ item }: { item: Task }) => (
      <View style={styles.cardWrap}>
        <TaskCard
          task={item}
          today={today}
          selected={selectedIds.includes(item.id)}
          selecting={selecting}
          onSelect={toggleSelect}
          onToggle={toggleComplete}
        />
      </View>
    ),
    [selectedIds, selecting, today, toggleSelect, toggleComplete],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; color: string | null; data: readonly unknown[] } }) => (
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: section.color ?? colors.mutedForeground }]} />
        <Text numberOfLines={2} style={styles.group}>{section.title}</Text>
        <View style={styles.groupCount}><Text style={styles.count}>{section.data.length}</Text></View>
      </View>
    ),
    [],
  );

  return (
    <Screen>
      <MobileHeader
        title={project?.title || "Tasks"}
        subtitle={
          project
            ? "Filtered by project"
            : activeView?.dataMode === "project"
              ? `${projectRows.length} ${projectRows.length === 1 ? "project" : "projects"}`
              : overdueCount
              ? `${openCount} open · ${overdueCount} overdue`
              : `${openCount} open`
        }
        actions={
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Customize view"
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterBtn, filtersOn && styles.filterBtnOn]}
          >
            <SlidersHorizontal size={16} color={filtersOn ? colors.primaryForeground : colors.foreground} />
            <Text style={[styles.filterBtnText, filtersOn && styles.filterBtnTextOn]}>
              {filtersOn ? "View · on" : "View"}
            </Text>
          </AnimatedPressable>
        }
      >
        {routeProjectId ? (
          <AnimatedPressable onPress={() => router.replace("/(app)/(tabs)/tasks")} style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>Clear project filter</Text>
          </AnimatedPressable>
        ) : null}
        <TaskFilterBar
          views={preview ? [...views, { ...preview, name: `Preview: ${preview.name}` }] : views}
          activeViewId={activeViewId}
          onView={selectView}
          onAdd={nativeViews.addView}
        />
      </MobileHeader>
      <ViewRulesBar
        view={activeView}
        vocab={vocab}
        onPatch={patchView}
        preview={
          preview
            ? {
                onSave: () => {
                  if (nativeViews.saveViewAsNew(preview)) setPreview(null);
                },
                onClose: () => setPreview(null),
              }
            : undefined
        }
      />
      {selecting ? (
        <View style={styles.bulk}>
          <Text style={styles.bulkCount}>{selectedIds.length} selected</Text>
          <ScrollView keyboardShouldPersistTaps="handled" horizontal style={styles.bulkScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkActions}>
          <AnimatedPressable
            style={styles.bulkButton}
            onPress={() => applyBulk({ completedAt: new Date().toISOString() }, ["completedAt", "statusId"], "Completed")}
          >
            <Text style={styles.bulkAction}>Complete</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.bulkButton}
            onPress={() => applyBulk({ completedAt: "" }, ["completedAt", "statusId"], "Reopened")}
          >
            <Text style={styles.bulkAction}>Reopen</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.bulkButton} onPress={() => setBulkPicker("menu")}>
            <Text style={styles.bulkAction}>More</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.bulkButton} onPress={() => setConfirmBulkDelete(true)}>
            <Text style={[styles.bulkAction, { color: colors.destructive }]}>Delete</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.bulkButton}
            onPress={() => {
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Clear</Text>
          </AnimatedPressable>
          </ScrollView>
        </View>
      ) : null}
      {/* The list view shows it in its header; board and project views above. */}
      {(boardMode || activeView?.dataMode === "project") && !routeProjectId && !networkCopy ? (
        <View style={{ paddingHorizontal: 16 }}>
          <StaleWorkCard />
        </View>
      ) : null}
      {boardMode && !networkCopy && visible.length > 0 ? (
        <MobileKanban
          columns={boardCols}
          today={today}
          selectedIds={selectedIds}
          selecting={selecting}
          onSelect={toggleSelect}
          onMove={moveOnBoard}
          hideStatus={(groupField(activeView) ?? "status") === "status"}
          onToggle={toggleComplete}
          refreshControl={refreshControl}
        />
      ) : networkCopy ? (
        <EmptyState icon={ListTodo} title="Couldn't load tasks" description={networkCopy} />
      ) : activeView?.dataMode === "project" ? (
        <SectionList showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          sections={projectSections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: projectsByWorkspace ? 0 : 8, paddingBottom: fabInset }}
          refreshControl={refreshControl}
          stickySectionHeadersEnabled={false}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <EmptyState icon={ListTodo} title="No projects in this view" description="Switch views or create a project." />
          }
          renderSectionHeader={({ section }) =>
            section.title ? renderSectionHeader({ section }) : null
          }
          renderItem={({ item }) => {
            const space = projectsByWorkspace ? undefined : workspaceById.get(item.workspaceId);
            const summary = [
              item.openCount > 0 ? `${item.openCount} open` : "No open tasks",
              item.scheduledCount > 0 ? `${item.scheduledCount} scheduled` : item.openCount > 0 ? "none scheduled" : "",
              item.deadline ? `Due ${formatShortDate(`${item.deadline.slice(0, 10)}T12:00:00`)}` : "",
            ].filter(Boolean).join(" · ");
            return (
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title || "Untitled project"}, ${summary}`}
                onPress={() => router.push(`/(app)/projects/${item.id}`)}
                style={styles.projectCard}
              >
                <View style={[styles.projectBar, { backgroundColor: resolvedColor(item.color, item.id) }]} />
                <View style={styles.projectBody}>
                  <Text numberOfLines={2} style={styles.projectTitle}>{item.title || "Untitled project"}</Text>
                  <View style={styles.projectMeta}>
                    {space ? (
                      <View style={styles.projectChip}>
                        <Dot color={resolvedColor(space.color, space.id)} />
                        <Text numberOfLines={1} style={styles.projectChipText}>{space.name}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.projectSummary}>{summary}</Text>
                  </View>
                </View>
              </AnimatedPressable>
            );
          }}
        />
      ) : boardMode ? (
        <EmptyState
          icon={ListTodo}
          title="All clear"
          description="Tap the + button to capture something new, then drag cards between board columns."
        />
      ) : (
        <SectionList showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={
            routeProjectId ? null : (
              <>
                <ScreenTip screen="tasks" style={{ marginTop: 8 }} />
                <StaleWorkCard />
              </>
            )
          }
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: fabInset }}
          refreshControl={refreshControl}
          extraData={selectedIds}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <EmptyState
              icon={ListTodo}
              title={activeView?.showReminders ? "No reminders" : "All clear"}
              description="Nothing matches this view. Adjust it with View, or tap + to add something."
            />
          }
        />
      )}
      <TaskFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        view={activeView ?? views[0] ?? defaultNativeTaskViews()[0]}
        onPatch={patchView}
        onAdd={nativeViews.addView}
        onDelete={() => (preview ? setPreview(null) : setConfirmDeleteView(true))}
        canDelete={views.length > 1}
        customFields={customFields}
        statusGroups={statusGroups}
        labels={labels}
        stages={stages}
        workspaces={workspaces}
        projects={projects}
      />
      <BottomSheet open={bulkPicker === "menu"} onClose={() => setBulkPicker(null)} title="Bulk edit">
        <SheetOption onSelect={() => setBulkPicker("status")}>Status</SheetOption>
        <SheetOption onSelect={() => setBulkPicker("priority")}>Priority</SheetOption>
        <SheetOption onSelect={() => setBulkPicker("project")}>Project</SheetOption>
        <SheetOption onSelect={() => setBulkPicker("label")}>Set label</SheetOption>
        <SheetOption onSelect={() => setBulkPicker("deadline")}>Deadline</SheetOption>
      </BottomSheet>
      <BottomSheet open={bulkPicker === "status"} onClose={() => setBulkPicker(null)} title="Status">
        {statusGroups.map((group) => (
          <SheetOption key={group.key} onSelect={() => applyNamedStatus(group.key)}>
            {group.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "priority"} onClose={() => setBulkPicker(null)} title="Priority">
        {PRIORITIES.map((priority) => (
          <SheetOption
            key={priority}
            onSelect={() => applyBulk({ priorityLevel: priority }, ["priorityLevel"], "Priority updated")}
          >
            {priority}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "project"} onClose={() => setBulkPicker(null)} title="Project">
        <SheetOption onSelect={() => applyBulk({ projectId: null }, ["projectId"], "Project cleared")}>
          No project
        </SheetOption>
        {projects.map((item) => (
          <SheetOption
            key={item.id}
            onSelect={() => applyBulk({ projectId: item.id }, ["projectId"], "Project updated")}
          >
            {item.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "label"} onClose={() => setBulkPicker(null)} title="Set label">
        {labelGroups.map((group) => (
          <SheetOption key={group.key} onSelect={() => applyLabel(group)}>
            {group.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "deadline"} onClose={() => setBulkPicker(null)} title="Deadline">
        <SheetOption
          onSelect={() =>
            applyBulk({ deadline: toDateInputValue(new Date()) }, ["deadline"], "Deadline set")
          }
        >
          Today
        </SheetOption>
        <SheetOption
          onSelect={() =>
            applyBulk(
              { deadline: toDateInputValue(addDays(startOfDay(new Date()), 1)) },
              ["deadline"],
              "Deadline set",
            )
          }
        >
          Tomorrow
        </SheetOption>
        <SheetOption onSelect={() => applyBulk({ deadline: null }, ["deadline"], "Deadline cleared")}>
          Clear deadline
        </SheetOption>
      </BottomSheet>
      <ConfirmSheet
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        title="Delete selected tasks?"
        message={`${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"} will be removed. This cannot be undone.`}
        onConfirm={() => {
          selectedIds.forEach((id) => remove.mutate(id));
          setSelectedIds([]);
          setBulkPicker(null);
        }}
      />
      <ConfirmSheet
        open={confirmDeleteView}
        onClose={() => setConfirmDeleteView(false)}
        title="Delete this view?"
        message="Only this phone’s task list layout is removed. Web views stay as they are."
        confirmLabel="Delete view"
        onConfirm={() => nativeViews.deleteActiveView()}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 22, paddingBottom: 12, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  group: { color: colors.foreground, fontSize: 17, fontWeight: "600", flex: 1, letterSpacing: -0.2 },
  groupCount: { minWidth: 26, height: 26, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.muted },
  count: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  bulk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bulkCount: { color: colors.foreground, fontSize: 12, fontWeight: "600", flexShrink: 0 },
  bulkScroll: { flex: 1, minWidth: 0 },
  bulkActions: { gap: 7, alignItems: "center" },
  bulkButton: { minHeight: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  bulkAction: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  // The task card's shape (16px corners, inset 4px stripe) so both line up.
  projectCard: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  projectBar: { width: 4, alignSelf: "stretch", borderRadius: 2, marginVertical: 12, marginLeft: 10 },
  projectBody: { flex: 1, minWidth: 0, minHeight: 76, justifyContent: "center", paddingVertical: 14, paddingLeft: 14, paddingRight: 16, gap: 7 },
  projectMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  projectChip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "60%", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.muted },
  projectChipText: { color: colors.foreground, fontSize: 12, fontWeight: "500", flexShrink: 1 },
  projectSummary: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", fontVariant: ["tabular-nums"] },
  cardWrap: { marginBottom: 10 },
  projectTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600", lineHeight: 21 },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  filterBtnOn: {
    backgroundColor: colors.primary,
  },
  filterBtnText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  filterBtnTextOn: { color: colors.primaryForeground },
}));
