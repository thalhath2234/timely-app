import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ListTodo } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import TaskCard from "../../../components/tasks/TaskCard";
import TaskFilterBar, { type TaskFilter } from "../../../components/tasks/TaskFilterBar";
import { useSaveTask, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { addDays, isOverdue, isSameDay, PRIORITY_ORDER, startOfDay } from "../../../lib/format";
import type { Task } from "../../../lib/types";
import { colors } from "../../../lib/theme";

function matchesFilter(task: Task, filter: TaskFilter) {
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
      return isOverdue(task.deadline, task.completedAt);
    case "upcoming":
      return Boolean(deadline && startOfDay(deadline) > startOfDay(today) && deadline <= addDays(startOfDay(today), 14));
    case "nodate":
      return !deadline;
  }
}

function sortTasks(a: Task, b: Task) {
  const pa = a.priorityLevel ? PRIORITY_ORDER.indexOf(a.priorityLevel) : 9;
  const pb = b.priorityLevel ? PRIORITY_ORDER.indexOf(b.priorityLevel) : 9;
  if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
  if (a.deadline && !b.deadline) return -1;
  if (!a.deadline && b.deadline) return 1;
  return pa - pb;
}

export default function TasksScreen() {
  const tasksQ = useTasksQuery();
  const spacesQ = useWorkspacesQuery();
  const save = useSaveTask();
  const tasks = tasksQ.data ?? [];
  const workspaces = spacesQ.data ?? [];
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      tasks
        .filter((t) => (t.duration ?? 0) > 0)
        .filter((t) => (workspaceId ? t.workspaceId === workspaceId : true)),
    [tasks, workspaceId],
  );
  const counts = useMemo(
    () => ({
      today: scoped.filter((t) => matchesFilter(t, "today")).length,
      overdue: scoped.filter((t) => matchesFilter(t, "overdue")).length,
    }),
    [scoped],
  );
  const groups = useMemo(() => {
    const visible = scoped.filter((t) => matchesFilter(t, filter)).sort(sortTasks);
    const map = new Map<string, { title: string; color: string | null; tasks: Task[] }>();
    for (const t of visible) {
      const key = t.projectId ?? `ws:${t.workspaceId}`;
      if (!map.has(key)) {
        map.set(key, {
          title: t.project?.title ?? `${t.workspace?.name ?? "Tasks"} · no project`,
          color: t.project?.color ?? null,
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(t);
    }
    return [...map.values()];
  }, [scoped, filter]);

  return (
    <Screen>
      <MobileHeader title="Tasks" subtitle={`${scoped.filter((t) => !t.completedAt).length} open`}>
        <TaskFilterBar
          filter={filter}
          onFilter={setFilter}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspace={setWorkspaceId}
          counts={counts}
        />
      </MobileHeader>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {groups.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={filter === "done" ? "Nothing completed yet" : "All clear"}
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
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onToggle={(t) =>
                      save.mutate({
                        id: t.id,
                        data: { completedAt: t.completedAt ? null : new Date().toISOString() },
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  group: { color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 },
  count: { color: colors.mutedForeground, fontSize: 12 },
});
