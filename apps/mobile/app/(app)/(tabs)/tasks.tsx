import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, RefreshControl, SectionList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ListTodo, SlidersHorizontal } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar, { type TaskFilter } from "../../../components/tasks/TaskFilterBar";
import MobileKanban, { kanbanColumns } from "../../../components/tasks/MobileKanban";
import TaskFiltersSheet from "../../../components/tasks/TaskFiltersSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import {
  useBulkUpdateTasks,
  useConfigQuery,
  useDeleteTask,
  useProjectsQuery,
  useSaveTask,
  useTasksQuery,
  useUpdateTaskViews,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { addDays, isSameDay, startOfDay, toDateInputValue } from "../../../lib/format";
import { PRIORITIES, priorityRank } from "../../../lib/priority";
import { isTaskOverdue } from "../../../lib/overdue";
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
  applyExtraFilters,
  EMPTY_EXTRA_FILTERS,
  extraFiltersActive,
  filterTasks,
  filtersFromView,
  isReminderTask,
  resolveViewShowCompleted,
  type ExtraTaskFilters,
} from "../../../lib/taskFilters";
import type { Task, TaskViewConfig } from "../../../lib/types";
import type { UpdateTaskPayload } from "../../../lib/api/tasks";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "reminders") return isReminderTask(task);
  if (filter === "board") return !isReminderTask(task);
  const done = Boolean(task.completedAt);
  if (filter === "done") return done;
  if (done) return false;
  if (filter === "all") return true;
  const deadline = task.deadline ? new Date(task.deadline) : null;
  const today = new Date();
  switch (filter) {
    case "today":
      return Boolean(deadline && isSameDay(deadline, today));
    case "overdue":
      return isTaskOverdue(task);
    case "upcoming":
      return Boolean(deadline && startOfDay(deadline) > startOfDay(today) && deadline <= addDays(startOfDay(today), 14));
    case "nodate":
      return !deadline;
    default:
      return true;
  }
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

function groupKey(task: Task, view?: TaskViewConfig, filter?: TaskFilter) {
  const field = view?.renderMode === "kanban" ? "status" : view?.groupFields?.[0];
  if (filter === "board" || field === "status") return statusNameKey(task.status?.name) || "none";
  if (field === "priority") return task.priorityLevel || "none";
  if (field === "workspace") return task.workspaceId || "none";
  if (field === "stage") return task.stageId || "none";
  return task.projectId ?? `ws:${task.workspaceId}`;
}

function groupTitle(task: Task, view?: TaskViewConfig, filter?: TaskFilter) {
  const field = view?.renderMode === "kanban" ? "status" : view?.groupFields?.[0];
  if (filter === "board" || field === "status") return task.status?.name ?? "No status";
  if (field === "priority") return task.priorityLevel ?? "No priority";
  if (field === "workspace") return task.workspace?.name ?? "No workspace";
  if (field === "stage") return "Stage";
  return task.project?.title ?? `${task.workspace?.name ?? "Tasks"} · no project`;
}

function groupColor(task: Task, view?: TaskViewConfig, filter?: TaskFilter) {
  const field = view?.renderMode === "kanban" ? "status" : view?.groupFields?.[0];
  if (filter === "board" || field === "status") return task.status?.color ?? null;
  return taskEntityColor(task);
}

export default function TasksScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const routeProjectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const tasksQ = useTasksQuery();
  const spacesQ = useWorkspacesQuery();
  const configQ = useConfigQuery();
  const saveViews = useUpdateTaskViews();
  const projects = useProjectsQuery().data ?? [];
  const save = useSaveTask();
  const bulk = useBulkUpdateTasks();
  const remove = useDeleteTask();
  const tasks = tasksQ.data ?? [];
  const workspaces = spacesQ.data ?? [];
  const networkCopy = needsNetworkCopy(tasksQ);
  const views = configQ.data?.taskViews ?? [];
  const [viewOverride, setViewOverride] = useState<string | null>(null);
  const latestViewSelection = useRef<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [barProjectId, setBarProjectId] = useState<string | null>(null);
  const [extraFilters, setExtraFilters] = useState<ExtraTaskFilters>(EMPTY_EXTRA_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [movingTask, setMovingTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState<
    null | "menu" | "status" | "priority" | "project" | "label" | "deadline"
  >(null);

  const configViewId =
    (configQ.data?.activeTaskViewId && views.some((view) => view.id === configQ.data?.activeTaskViewId)
      ? configQ.data.activeTaskViewId
      : views[0]?.id) ?? "";
  const activeViewId =
    viewOverride && views.some((view) => view.id === viewOverride) ? viewOverride : configViewId;
  const activeView = views.find((view) => view.id === activeViewId);
  const viewShowCompleted = activeView ? resolveViewShowCompleted(activeView) : true;
  const extraDefaults = useMemo(
    () => ({ ...EMPTY_EXTRA_FILTERS, showCompleted: viewShowCompleted }),
    [viewShowCompleted],
  );
  useEffect(() => {
    setExtraFilters((current) =>
      current.showCompleted === viewShowCompleted ? current : { ...current, showCompleted: viewShowCompleted },
    );
  }, [activeViewId, viewShowCompleted]);
  const projectId = routeProjectId ?? barProjectId;
  const project = projects.find((item) => item.id === projectId);
  const barProjects = useMemo(
    () => projects.filter((item) => (workspaceId ? item.workspaceId === workspaceId : true)),
    [projects, workspaceId],
  );

  useEffect(() => {
    if (viewOverride && configQ.data?.activeTaskViewId === viewOverride) {
      latestViewSelection.current = null;
      setViewOverride(null);
    }
  }, [configQ.data?.activeTaskViewId, viewOverride]);

  const workScoped = useMemo(
    () =>
      tasks
        .filter((t) => !isReminderTask(t) && t.kind !== "inbox")
        .filter((t) => (workspaceId ? t.workspaceId === workspaceId : true)),
    [tasks, workspaceId],
  );
  const counts = useMemo(
    () => ({
      today: workScoped.filter((t) => matchesFilter(t, "today")).length,
      overdue: workScoped.filter((t) => matchesFilter(t, "overdue")).length,
    }),
    [workScoped],
  );

  const visible = useMemo(() => {
    let next: Task[];
    if (filter === "board") {
      next = tasks.filter((t) => !isReminderTask(t) && t.kind !== "inbox" && !t.parentTaskId);
    } else if (activeView) {
      next =
        activeView.dataMode === "project"
          ? []
          : filterTasks(tasks, { ...filtersFromView(activeView), showCompleted: extraFilters.showCompleted });
    } else {
      next = tasks
        .filter((t) => (filter === "reminders" ? isReminderTask(t) : !isReminderTask(t)))
        .filter((t) => matchesFilter(t, filter));
    }
    return applyExtraFilters(
      next
        .filter((t) => (workspaceId ? t.workspaceId === workspaceId : true))
        .filter((t) => (projectId ? t.projectId === projectId : true))
        .sort((a, b) => sortTasks(a, b, filter === "board" ? undefined : activeView)),
      extraFilters,
    );
  }, [tasks, workspaceId, projectId, filter, activeView, extraFilters]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; color: string | null; tasks: Task[] }>();
    for (const t of visible) {
      const key = groupKey(t, activeView, filter);
      if (!map.has(key)) {
        map.set(key, {
          title: groupTitle(t, activeView, filter),
          color: groupColor(t, activeView, filter),
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(t);
    }
    return [...map.values()];
  }, [visible, activeView, filter]);

  const sections = useMemo(
    () => groups.map((group) => ({ title: group.title, color: group.color, data: group.tasks })),
    [groups],
  );

  const projectRows = useMemo(() => {
    if (activeView?.dataMode !== "project") return [];
    const wanted = new Set(activeView.selectedWorkspaceIds ?? []);
    return projects
      .filter((item) => {
        if (workspaceId && item.workspaceId !== workspaceId) return false;
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
  }, [activeView, projects, projectId, workspaceId, tasks]);

  const selecting = selectedIds.length > 0;
  const statuses = useMemo(
    () =>
      workspaces
        .filter((space) => (workspaceId ? space.id === workspaceId : true))
        .flatMap((space) => space.status ?? []),
    [workspaces, workspaceId],
  );
  const statusGroups = useMemo(() => mergeStatusesByName(statuses), [statuses]);
  const labels = useMemo(
    () =>
      workspaces
        .filter((space) => (workspaceId ? space.id === workspaceId : true))
        .flatMap((space) => space.lables ?? []),
    [workspaces, workspaceId],
  );
  const stages = useMemo(
    () =>
      projects
        .filter((item) => (workspaceId ? item.workspaceId === workspaceId : true))
        .flatMap((item) => item.stages ?? []),
    [projects, workspaceId],
  );
  const boardMode =
    filter === "board" || (activeView?.renderMode === "kanban" && activeView.dataMode !== "project");
  const boardCols = useMemo(() => kanbanColumns(visible, statusGroups), [visible, statusGroups]);

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
    setFilter("all");
    setSelectedIds((current) => (current.length > 0 ? [] : current));
    if (!id || id === activeViewId) return;
    const nextView = views.find((view) => view.id === id);
    const nextShowCompleted = nextView ? resolveViewShowCompleted(nextView) : true;
    setExtraFilters((current) =>
      current.showCompleted === nextShowCompleted
        ? current
        : { ...current, showCompleted: nextShowCompleted },
    );
    latestViewSelection.current = id;
    setViewOverride(id);
    saveViews.mutate(
      { taskViews: views, activeTaskViewId: id },
      {
        onError: () => {
          if (latestViewSelection.current !== id) return;
          latestViewSelection.current = null;
          setViewOverride(null);
        },
      },
    );
  }

  const toggleComplete = useCallback((task: Task) => {
    save.mutate({
      id: task.id,
      data: { completedAt: task.completedAt ? null : new Date().toISOString() },
    });
  }, [save]);

  const openCount = useMemo(() => visible.filter((task) => !task.completedAt).length, [visible]);
  const overdueCount = useMemo(
    () => visible.filter((task) => matchesFilter(task, "overdue")).length,
    [visible],
  );
  const filtersOn = extraFiltersActive(extraFilters, viewShowCompleted);
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
          selected={selectedIds.includes(item.id)}
          selecting={selecting}
          onSelect={toggleSelect}
          onToggle={toggleComplete}
        />
      </View>
    ),
    [selectedIds, selecting, toggleSelect, toggleComplete],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; color: string | null; data: Task[] } }) => (
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: section.color ?? colors.mutedForeground }]} />
        <Text style={styles.group}>{section.title}</Text>
        <Text style={styles.count}>{section.data.length}</Text>
      </View>
    ),
    [],
  );

  return (
    <Screen>
      <MobileHeader
        title={
          activeView?.dataMode === "project" && filter !== "board"
            ? activeView.name
            : filter === "reminders"
              ? "Reminders"
              : filter === "board"
                ? "Board"
                : project?.title || (filter === "all" ? activeView?.name : undefined) || "Tasks"
        }
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
            accessibilityLabel="Filters"
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterBtn, filtersOn && styles.filterBtnOn]}
          >
            <SlidersHorizontal size={16} color={filtersOn ? colors.primaryForeground : colors.foreground} />
            <Text style={[styles.filterBtnText, filtersOn && styles.filterBtnTextOn]}>
              {filtersOn ? "Filters · on" : "Filters"}
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
          filter={filter}
          onFilter={(next) => {
            setFilter(next);
            setSelectedIds((current) => (current.length > 0 ? [] : current));
          }}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspace={(id) => {
            setWorkspaceId(id);
            if (barProjectId && !projects.some((item) => item.id === barProjectId && (!id || item.workspaceId === id))) {
              setBarProjectId(null);
            }
          }}
          projects={routeProjectId ? [] : barProjects}
          projectId={barProjectId}
          onProject={routeProjectId ? undefined : setBarProjectId}
          counts={counts}
          views={views}
          activeViewId={activeViewId}
          onView={selectView}
        />
      </MobileHeader>
      {selecting ? (
        <View style={styles.bulk}>
          <Text style={styles.bulkCount}>{selectedIds.length} selected</Text>
          <AnimatedPressable
            onPress={() => {
              const ids = selectedIds;
              bulk.mutate({ ids, update: { completedAt: new Date().toISOString() } });
              showUndoToast("Completed", () => bulk.mutate({ ids, update: { completedAt: null } }));
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Complete</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => {
              const ids = selectedIds;
              bulk.mutate({ ids, update: { completedAt: null } });
              showUndoToast("Reopened", () =>
                bulk.mutate({ ids, update: { completedAt: new Date().toISOString() } }),
              );
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Reopen</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={() => setBulkPicker("menu")}>
            <Text style={styles.bulkAction}>More</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={() => setConfirmBulkDelete(true)}>
            <Text style={[styles.bulkAction, { color: colors.destructive }]}>Delete</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => {
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Clear</Text>
          </AnimatedPressable>
        </View>
      ) : null}
      {boardMode && !networkCopy && visible.length > 0 ? (
        <MobileKanban
          columns={boardCols}
          selectedIds={selectedIds}
          selecting={selecting}
          onSelect={toggleSelect}
          onMove={setMovingTask}
          onToggle={toggleComplete}
          refreshControl={refreshControl}
        />
      ) : networkCopy ? (
        <EmptyState icon={ListTodo} title="Couldn't load tasks" description={networkCopy} />
      ) : activeView?.dataMode === "project" && filter !== "board" ? (
        <FlatList
          data={projectRows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 110 }}
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
          description="Tap the + button to capture something new, then long-press a card to change status."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 110 }}
          refreshControl={refreshControl}
          extraData={selectedIds}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <EmptyState
              icon={ListTodo}
              title={filter === "done" ? "Nothing completed yet" : filter === "reminders" ? "No reminders" : "All clear"}
              description={activeView ? "Nothing matches this saved view." : "Tap the + button to capture something new."}
            />
          }
        />
      )}
      <TaskFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={extraFilters}
        onChange={setExtraFilters}
        defaults={extraDefaults}
        statusGroups={statusGroups}
        labels={labels}
        stages={stages}
        workspaces={workspaces}
        projects={projects}
      />
      <BottomSheet
        open={Boolean(movingTask)}
        onClose={() => setMovingTask(null)}
        title="Move to status"
      >
        {statusGroups.map((group) => (
          <SheetOption
            key={group.key}
            selected={statusNameKey(movingTask?.status?.name) === group.key}
            onSelect={() => {
              if (movingTask) applyStatus(movingTask, group.key);
              setMovingTask(null);
            }}
          >
            {group.name}
          </SheetOption>
        ))}
      </BottomSheet>
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
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  group: { color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 },
  count: { color: colors.mutedForeground, fontSize: 12 },
  bulk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bulkCount: { flex: 1, color: colors.foreground, fontWeight: "600" },
  bulkAction: { color: colors.primary, fontWeight: "600" },
  projectCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  cardWrap: { marginBottom: 8 },
  projectTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterBtnOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterBtnText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  filterBtnTextOn: { color: colors.primaryForeground },
}));
