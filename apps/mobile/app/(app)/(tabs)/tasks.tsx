import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ListTodo } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar, { type TaskFilter } from "../../../components/tasks/TaskFilterBar";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ListEnter from "../../../components/ui/ListEnter";
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
import { mergeStatusesByName, statusNameKey } from "../../../lib/status";
import { showUndoToast } from "../../../lib/toast";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { filterTasks, filtersFromView, isReminderTask } from "../../../lib/taskFilters";
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
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
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
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState<
    null | "menu" | "status" | "priority" | "project" | "label" | "deadline"
  >(null);

  const activeViewId =
    (configQ.data?.activeTaskViewId && views.some((view) => view.id === configQ.data?.activeTaskViewId)
      ? configQ.data.activeTaskViewId
      : views[0]?.id) ?? "";
  const activeView = views.find((view) => view.id === activeViewId);
  const project = projects.find((item) => item.id === projectId);

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

  const groups = useMemo(() => {
    let visible: Task[];
    if (activeView) {
      visible = filterTasks(tasks, filtersFromView(activeView));
      if (activeView.dataMode === "project") {
        visible = [];
      }
    } else {
      visible = tasks
        .filter((t) => (filter === "reminders" ? isReminderTask(t) : !isReminderTask(t)))
        .filter((t) => matchesFilter(t, filter));
    }
    visible = visible
      .filter((t) => (workspaceId ? t.workspaceId === workspaceId : true))
      .filter((t) => (projectId ? t.projectId === projectId : true))
      .sort((a, b) => sortTasks(a, b, activeView));

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
  }, [tasks, workspaceId, projectId, filter, activeView]);

  const projectRows = useMemo(() => {
    if (activeView?.dataMode !== "project") return [];
    const wanted = new Set(activeView.selectedWorkspaceIds ?? []);
    return projects.filter((item) => {
      if (wanted.size > 0 && !wanted.has(item.workspaceId)) return false;
      if (projectId && item.id !== projectId) return false;
      return true;
    });
  }, [activeView, projects, projectId]);

  const selecting = selectedIds.length > 0;
  const statuses = useMemo(
    () => workspaces.flatMap((space) => space.status ?? []),
    [workspaces],
  );
  const statusGroups = useMemo(() => mergeStatusesByName(statuses), [statuses]);
  const labels = useMemo(
    () => workspaces.flatMap((space) => space.lables ?? []),
    [workspaces],
  );

  function toggleSelect(task: Task) {
    setSelectedIds((current) =>
      current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id],
    );
  }

  function applyBulk(update: UpdateTaskPayload, undo: UpdateTaskPayload, message: string) {
    const ids = selectedIds;
    bulk.mutate({ ids, update });
    showUndoToast(message, () => bulk.mutate({ ids, update: undo }));
    setSelectedIds([]);
    setBulkPicker(null);
  }

  function applyNamedStatus(nameKey: string) {
    const group = statusGroups.find((item) => item.key === nameKey);
    if (!group) return;
    const ids = selectedIds;
    const byWorkspace = new Map(group.statuses.map((status) => [status.workspaceId, status]));
    ids.forEach((id) => {
      const task = tasks.find((item) => item.id === id);
      const status = byWorkspace.get(task?.workspaceId ?? "");
      if (!status) return;
      save.mutate({ id, data: { statusId: status.id } });
    });
    showUndoToast("Status updated", () => {
      ids.forEach((id) => save.mutate({ id, data: { statusId: null } }));
    });
    setSelectedIds([]);
    setBulkPicker(null);
  }

  function selectView(id: string) {
    if (!id || id === activeViewId) return;
    saveViews.mutate({ taskViews: views, activeTaskViewId: id });
    setSelectedIds([]);
  }

  const openCount = activeView
    ? filterTasks(tasks, { ...filtersFromView(activeView), showCompleted: false }).length
    : workScoped.filter((t) => !t.completedAt).length;

  return (
    <Screen>
      <MobileHeader
        title={
          activeView?.dataMode === "project"
            ? activeView.name
            : filter === "reminders"
              ? "Reminders"
              : project?.title || activeView?.name || "Tasks"
        }
        subtitle={project ? "Filtered by project" : `${openCount} open`}
      >
        {projectId ? (
          <Pressable onPress={() => router.replace("/(app)/(tabs)/tasks")} style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>Clear project filter</Text>
          </Pressable>
        ) : null}
        <TaskFilterBar
          filter={filter}
          onFilter={(next) => {
            setFilter(next);
            setSelectedIds([]);
          }}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspace={setWorkspaceId}
          counts={counts}
          views={views}
          activeViewId={activeViewId}
          onView={selectView}
        />
      </MobileHeader>
      {selecting ? (
        <View style={styles.bulk}>
          <Text style={styles.bulkCount}>{selectedIds.length} selected</Text>
          <Pressable
            onPress={() => {
              const ids = selectedIds;
              bulk.mutate({ ids, update: { completedAt: new Date().toISOString() } });
              showUndoToast("Completed", () => bulk.mutate({ ids, update: { completedAt: null } }));
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Complete</Text>
          </Pressable>
          <Pressable
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
          </Pressable>
          <Pressable onPress={() => setBulkPicker("menu")}>
            <Text style={styles.bulkAction}>More</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              selectedIds.forEach((id) => remove.mutate(id));
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={[styles.bulkAction, { color: colors.destructive }]}>Delete</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setSelectedIds([]);
              setBulkPicker(null);
            }}
          >
            <Text style={styles.bulkAction}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={tasksQ.isRefetching && !tasksQ.isPending}
            onRefresh={() => void tasksQ.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {networkCopy ? (
          <EmptyState icon={ListTodo} title="Couldn't load tasks" description={networkCopy} />
        ) : activeView?.dataMode === "project" ? (
          projectRows.length === 0 ? (
            <EmptyState icon={ListTodo} title="No projects in this view" description="Switch views or create a project." />
          ) : (
            <View style={{ paddingHorizontal: 12, gap: 8, paddingTop: 8 }}>
              {projectRows.map((item, index) => (
                <ListEnter key={item.id} index={index}>
                  <Pressable onPress={() => router.push(`/(app)/projects/${item.id}`)} style={styles.projectCard}>
                    <Text style={styles.projectTitle}>{item.title}</Text>
                    <Text style={styles.count}>{item.status?.name || "Open project"}</Text>
                  </Pressable>
                </ListEnter>
              ))}
            </View>
          )
        ) : groups.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={filter === "done" ? "Nothing completed yet" : filter === "reminders" ? "No reminders" : "All clear"}
            description={activeView ? "Nothing matches this saved view." : "Tap the + button to capture something new."}
          />
        ) : (
          groups.map((group) => (
            <View key={group.title} style={{ paddingHorizontal: 12 }}>
              <View style={styles.head}>
                <View style={[styles.dot, { backgroundColor: group.color ?? colors.mutedForeground }]} />
                <Text style={styles.group}>{group.title}</Text>
                <Text style={styles.count}>{group.tasks.length}</Text>
              </View>
              <View style={{ gap: 8 }}>
                {group.tasks.map((task, index) => (
                  <ListEnter key={task.id} index={index}>
                    <TaskCard
                      task={task}
                      selected={selectedIds.includes(task.id)}
                      selecting={selecting}
                      onSelect={toggleSelect}
                      onToggle={(t) =>
                        save.mutate({
                          id: t.id,
                          data: { completedAt: t.completedAt ? null : new Date().toISOString() },
                        })
                      }
                    />
                  </ListEnter>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
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
  },
  projectTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
}));
