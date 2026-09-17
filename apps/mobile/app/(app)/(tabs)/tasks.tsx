import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ListTodo } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar, { type TaskFilter } from "../../../components/tasks/TaskFilterBar";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ListEnter from "../../../components/ui/ListEnter";
import { useBulkUpdateTasks, useDeleteTask, useProjectsQuery, useSaveTask, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { addDays, isSameDay, startOfDay, toDateInputValue } from "../../../lib/format";
import { PRIORITIES, priorityRank } from "../../../lib/priority";
import { isTaskOverdue } from "../../../lib/overdue";
import { taskEntityColor } from "../../../lib/entityColor";
import { mergeStatusesByName, statusNameKey } from "../../../lib/status";
import { showUndoToast } from "../../../lib/toast";
import type { Task } from "../../../lib/types";
import type { UpdateTaskPayload } from "../../../lib/api/tasks";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "reminders") return (task.duration ?? 0) <= 0;
  if (filter === "board") return (task.duration ?? 0) > 0;
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

function sortTasks(a: Task, b: Task) {
  const pa = priorityRank(a.priorityLevel);
  const pb = priorityRank(b.priorityLevel);
  if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
  if (a.deadline && !b.deadline) return -1;
  if (!a.deadline && b.deadline) return 1;
  return pa - pb;
}

export default function TasksScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const tasksQ = useTasksQuery();
  const spacesQ = useWorkspacesQuery();
  const projects = useProjectsQuery().data ?? [];
  const save = useSaveTask();
  const bulk = useBulkUpdateTasks();
  const remove = useDeleteTask();
  const tasks = tasksQ.data ?? [];
  const workspaces = spacesQ.data ?? [];
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState<
    null | "menu" | "status" | "priority" | "project" | "label" | "deadline"
  >(null);

  const project = projects.find((item) => item.id === projectId);
  const scoped = useMemo(
    () =>
      tasks
        .filter((t) => (filter === "reminders" ? (t.duration ?? 0) <= 0 : (t.duration ?? 0) > 0))
        .filter((t) => (workspaceId ? t.workspaceId === workspaceId : true))
        .filter((t) => (projectId ? t.projectId === projectId : true)),
    [tasks, workspaceId, projectId, filter],
  );
  const workScoped = useMemo(
    () => tasks.filter((t) => (t.duration ?? 0) > 0).filter((t) => (workspaceId ? t.workspaceId === workspaceId : true)),
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
    const visible = scoped.filter((t) => matchesFilter(t, filter)).sort(sortTasks);
    const map = new Map<string, { title: string; color: string | null; tasks: Task[] }>();
    for (const t of visible) {
      const key =
        filter === "board"
          ? statusNameKey(t.status?.name) || "none"
          : t.projectId ?? `ws:${t.workspaceId}`;
      if (!map.has(key)) {
        map.set(key, {
          title:
            filter === "board"
              ? t.status?.name ?? "No status"
              : t.project?.title ?? `${t.workspace?.name ?? "Tasks"} · no project`,
          color: filter === "board" ? t.status?.color ?? null : taskEntityColor(t),
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(t);
    }
    return [...map.values()];
  }, [scoped, filter]);

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

  return (
    <Screen>
      <MobileHeader
        title={filter === "reminders" ? "Reminders" : project?.title || "Tasks"}
        subtitle={project ? "Filtered by project" : `${workScoped.filter((t) => !t.completedAt).length} open`}
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
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {tasksQ.isError ? (
          <EmptyState
            icon={ListTodo}
            title="Couldn't load tasks"
            description="Check your connection and pull to retry."
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={filter === "done" ? "Nothing completed yet" : filter === "reminders" ? "No reminders" : "All clear"}
            description="Tap the + button to capture something new."
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
}));
