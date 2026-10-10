import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, RefreshControl, ScrollView, SectionList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ListTodo, SlidersHorizontal } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar from "../../../components/tasks/TaskFilterBar";
import StaleWorkCard from "../../../components/tasks/StaleWorkCard";
import ScreenTip from "../../../components/ui/ScreenTip";
import MobileKanban, { kanbanColumns } from "../../../components/tasks/MobileKanban";
import TaskFiltersSheet from "../../../components/tasks/TaskFiltersSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import {
  useBulkUpdateTasks,
  useDeleteTask,
  useProjectsQuery,
  useSaveTask,
  useTasksQuery,
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { addDays, startOfDay, toDateInputValue } from "../../../lib/format";
import { PRIORITIES, priorityRank } from "../../../lib/priority";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { taskEntityColor } from "../../../lib/entityColor";
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
import type { UpdateTaskPayload } from "../../../lib/api/tasks";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

function groupField(view?: TaskViewConfig): TaskListGroupField | undefined {
  if (view?.renderMode === "kanban") return view.groupFields?.[0] ?? "status";
  return view?.groupFields?.[0];
}

function groupValue(task: Task, field: TaskListGroupField, stageNames: Record<string, string>) {
  if (field === "status") return statusNameKey(task.status?.name) || "none";
  if (field === "priority") return task.priorityLevel || "none";
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
  if (field === "priority") return task.priorityLevel ?? "No priority";
  if (field === "workspace") return task.workspace?.name ?? "No workspace";
  if (field === "project") return task.project?.title ?? "No project";
  if (field === "stage") return (task.stageId && stageNames[task.stageId]) || "No stage";
  if (field?.startsWith("cf:")) return customFieldGroupLabel(task, field.slice(3));
  return "Other";
}

function groupFields(view?: TaskViewConfig): TaskListGroupField[] {
  if (view?.renderMode === "kanban") return [view.groupFields?.[0] ?? "status"];
  return view?.groupFields?.length ? view.groupFields.slice(0, 3) : ["project"];
}

function groupKey(task: Task, view: TaskViewConfig | undefined, stageNames: Record<string, string>) {
  return groupFields(view).map((field) => `${field}:${groupValue(task, field, stageNames)}`).join("|");
}

function groupTitle(task: Task, view: TaskViewConfig | undefined, stageNames: Record<string, string>) {
  return groupFields(view).map((field) => groupValueTitle(task, field, stageNames)).join(" › ");
}

function groupColor(task: Task, view?: TaskViewConfig) {
  const field = groupField(view);
  if (field === "status") return task.status?.color ?? null;
  if (field === "workspace") return task.workspace?.color ?? null;
  if (field === "project") return task.project?.color ?? null;
  return taskEntityColor(task);
}

function viewHasCustomFilters(view?: TaskViewConfig) {
  if (!view) return false;
  return Boolean(
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

function sortTasks(a: Task, b: Task, view?: TaskViewConfig) {
  const dir = view?.sortDirection === "desc" ? -1 : 1;
  const by = view?.sortBy ?? "deadline";
  const cmp = (left: number | string, right: number | string) => {
    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return 0;
  };
  switch (by) {
    case "name":
      return cmp(a.name.toLowerCase(), b.name.toLowerCase());
    case "createdAt":
      return cmp(a.createdAt, b.createdAt);
    case "startDate":
      return cmp(a.startDate ?? "zzz", b.startDate ?? "zzz");
    case "scheduledOn":
      return cmp(a.scheduledOn ?? a.blocks?.[0]?.start ?? "zzz", b.scheduledOn ?? b.blocks?.[0]?.start ?? "zzz");
    case "priority":
      return (priorityRank(a.priorityLevel) - priorityRank(b.priorityLevel)) * dir;
    case "status":
      return cmp((a.status?.name ?? "").toLowerCase(), (b.status?.name ?? "").toLowerCase());
    case "project":
      return cmp((a.project?.title ?? "").toLowerCase(), (b.project?.title ?? "").toLowerCase());
    case "deadline":
    default: {
      if (a.deadline && b.deadline && a.deadline !== b.deadline) return cmp(a.deadline, b.deadline);
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && b.deadline) return 1;
      return priorityRank(a.priorityLevel) - priorityRank(b.priorityLevel);
    }
  }
}

export default function TasksScreen() {
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
  const activeView = nativeViews.activeView;
  const activeViewId = nativeViews.activeViewId;
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

  const visible = useMemo(() => {
    if (!activeView || activeView.dataMode === "project") return [];
    return filterTasks(tasks, filtersFromView(activeView), workingHoursZone)
      .filter((task) => (projectId ? task.projectId === projectId : true))
      .sort((a, b) => sortTasks(a, b, activeView));
  }, [tasks, projectId, activeView, workingHoursZone]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; color: string | null; tasks: Task[] }>();
    for (const task of visible) {
      const key = groupKey(task, activeView, stageNames);
      if (!map.has(key)) {
        map.set(key, {
          title: groupTitle(task, activeView, stageNames),
          color: groupColor(task, activeView),
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(task);
    }
    const rows = [...map.values()];
    const ordered = activeView?.groupValueOrders?.[groupField(activeView) ?? ""];
    rows.sort((a, b) => {
      if (ordered?.length) {
        const left = ordered.indexOf(a.title);
        const right = ordered.indexOf(b.title);
        if (left !== -1 || right !== -1) {
          return (left === -1 ? ordered.length : left) - (right === -1 ? ordered.length : right);
        }
      }
      const cmp = a.title.localeCompare(b.title);
      return activeView?.groupSortDirection === "desc" ? -cmp : cmp;
    });
    return rows;
  }, [visible, activeView, stageNames]);

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

  function applyBulk(update: UpdateTaskPayload, undo: UpdateTaskPayload, message: string) {
    const ids = selectedIds;
    bulk.mutate({ ids, update });
    showUndoToast(message, () => bulk.mutate({ ids, update: undo }));
    setSelectedIds([]);
    setBulkPicker(null);
  }

  function applyStatus(task: Task, nameKey: string) {
    const group = statusGroups.find((item) => item.key === nameKey);
    if (!group) return;
    const status = statusForWorkspace(group, task.workspaceId);
    if (!status) return;
    const patch = statusPatch(status, task.completedAt);
    const previous = { statusId: task.statusId ?? null, completedAt: task.completedAt ?? null };
    save.mutate({ id: task.id, data: patch });
    showUndoToast("Status updated", () => save.mutate({ id: task.id, data: previous }));
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
    ({ section }: { section: { title: string; color: string | null; data: Task[] } }) => (
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
          views={views}
          activeViewId={activeViewId}
          onView={selectView}
          onAdd={nativeViews.addView}
        />
      </MobileHeader>
      {selecting ? (
        <View style={styles.bulk}>
          <Text style={styles.bulkCount}>{selectedIds.length} selected</Text>
          <ScrollView horizontal style={styles.bulkScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkActions}>
          <AnimatedPressable
            style={styles.bulkButton}
            onPress={() => {
              const ids = selectedIds;
              bulk.mutate({ ids, update: { completedAt: new Date().toISOString() } });
              showUndoToast("Completed", () => bulk.mutate({ ids, update: { completedAt: "" } }));
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Complete</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.bulkButton}
            onPress={() => {
              const ids = selectedIds;
              bulk.mutate({ ids, update: { completedAt: "" } });
              showUndoToast("Reopened", () =>
                bulk.mutate({ ids, update: { completedAt: new Date().toISOString() } }),
              );
              setSelectedIds([]);
              setBulkPicker(null);
            }}
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
      {boardMode && !networkCopy && visible.length > 0 ? (
        <MobileKanban
          columns={boardCols}
          today={today}
          selectedIds={selectedIds}
          selecting={selecting}
          onSelect={toggleSelect}
          onMove={(task, column) => {
            if (groupField(activeView) === "status") applyStatus(task, column.key);
            else {
              const field = groupField(activeView);
              const key = field === "priority" ? "priorityLevel" : field === "workspace" ? "workspaceId" : field === "project" ? "projectId" : field === "stage" ? "stageId" : null;
              if (key) save.mutate({ id: task.id, data: { [key]: column.key === "none" ? "" : column.key } });
            }
          }}
          onToggle={toggleComplete}
          refreshControl={refreshControl}
        />
      ) : networkCopy ? (
        <EmptyState icon={ListTodo} title="Couldn't load tasks" description={networkCopy} />
      ) : activeView?.dataMode === "project" ? (
        <FlatList
          data={projectRows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 }}
          refreshControl={refreshControl}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <EmptyState icon={ListTodo} title="No projects in this view" description="Switch views or create a project." />
          }
          renderItem={({ item }) => (
            <AnimatedPressable
              onPress={() => router.push(`/(app)/projects/${item.id}`)}
              style={styles.projectCard}
            >
              <Text style={styles.projectTitle}>{item.title}</Text>
              <Text style={styles.count}>
                {item.scheduledCount > 0
                  ? `${item.scheduledCount} scheduled`
                  : "No scheduled tasks in this project."}
              </Text>
              {item.openCount > 0 ? (
                <Text style={styles.count}>{item.openCount} open</Text>
              ) : null}
            </AnimatedPressable>
          )}
        />
      ) : boardMode ? (
        <EmptyState
          icon={ListTodo}
          title="All clear"
          description="Tap the + button to capture something new, then drag cards between board columns."
        />
      ) : (
        <SectionList
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
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
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
        onPatch={nativeViews.patchActiveView}
        onAdd={nativeViews.addView}
        onDelete={() => setConfirmDeleteView(true)}
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
            onSelect={() => applyBulk({ priorityLevel: priority }, { priorityLevel: null }, "Priority updated")}
          >
            {priority}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "project"} onClose={() => setBulkPicker(null)} title="Project">
        <SheetOption onSelect={() => applyBulk({ projectId: null }, { projectId: null }, "Project cleared")}>
          No project
        </SheetOption>
        {projects.map((item) => (
          <SheetOption
            key={item.id}
            onSelect={() => applyBulk({ projectId: item.id }, { projectId: null }, "Project updated")}
          >
            {item.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "label"} onClose={() => setBulkPicker(null)} title="Set label">
        {labels.map((label) => (
          <SheetOption
            key={label.id}
            onSelect={() => applyBulk({ labelIds: [{ id: label.id }] }, { labelIds: [] }, `Labeled ${label.name}`)}
          >
            {label.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={bulkPicker === "deadline"} onClose={() => setBulkPicker(null)} title="Deadline">
        <SheetOption
          onSelect={() =>
            applyBulk({ deadline: toDateInputValue(new Date()) }, { deadline: null }, "Deadline set")
          }
        >
          Today
        </SheetOption>
        <SheetOption
          onSelect={() =>
            applyBulk(
              { deadline: toDateInputValue(addDays(startOfDay(new Date()), 1)) },
              { deadline: null },
              "Deadline set",
            )
          }
        >
          Tomorrow
        </SheetOption>
        <SheetOption onSelect={() => applyBulk({ deadline: null }, { deadline: null }, "Deadline cleared")}>
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
  group: { color: colors.foreground, fontSize: 17, fontWeight: "800", flex: 1, letterSpacing: -0.2 },
  groupCount: { minWidth: 26, height: 26, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.muted },
  count: { color: colors.mutedForeground, fontSize: 12, fontWeight: "700" },
  bulk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bulkCount: { color: colors.foreground, fontSize: 12, fontWeight: "800", flexShrink: 0 },
  bulkScroll: { flex: 1, minWidth: 0 },
  bulkActions: { gap: 7, alignItems: "center" },
  bulkButton: { minHeight: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  bulkAction: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  projectCard: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
    marginBottom: 10,
  },
  cardWrap: { marginBottom: 10 },
  projectTitle: { color: colors.foreground, fontSize: 17, fontWeight: "700" },
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
