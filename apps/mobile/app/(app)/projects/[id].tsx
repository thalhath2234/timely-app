import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronDown, ChevronUp, FolderKanban, ListTodo, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import { Field, PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
import {
  useCreateStage,
  useDeleteProject,
  useDeleteStage,
  useDuplicateProject,
  useProjectQuery,
  useProjectsQuery,
  useReorderStages,
  useSaveTask,
  useTasksQuery,
  useUpdateProject,
  useUpdateStage,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { PRIORITIES } from "../../../lib/priority";
import { showUndoToast } from "../../../lib/toast";
import { formatShortDate, toDateInputValue } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import type { Stage, Task } from "../../../lib/types";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const projectQ = useProjectQuery(id);
  const listProject = (useProjectsQuery().data ?? []).find((item) => item.id === id);
  const project = projectQ.data ?? listProject;
  const tasks = useTasksQuery().data ?? [];
  const spaces = useWorkspacesQuery().data ?? [];
  const save = useUpdateProject();
  const remove = useDeleteProject();
  const duplicate = useDuplicateProject();
  const addStage = useCreateStage();
  const renameStage = useUpdateStage();
  const deleteStage = useDeleteStage();
  const reorder = useReorderStages();
  const saveTask = useSaveTask();
  const [stageName, setStageName] = useState("");
  const [picker, setPicker] = useState<"status" | "priority" | "start" | "deadline" | null>(null);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [stageDraft, setStageDraft] = useState("");
  const [movingTask, setMovingTask] = useState<Task | null>(null);

  const workspace = spaces.find((space) => space.id === project?.workspaceId);
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === id),
    [tasks, id],
  );
  const stages = [...(project?.stages ?? [])].sort((a, b) => a.order - b.order);
  const board = useMemo(() => {
    const byStage = new Map<string, Task[]>();
    const unstaged: Task[] = [];
    for (const task of projectTasks) {
      if (task.stageId && stages.some((stage) => stage.id === task.stageId)) {
        const existing = byStage.get(task.stageId) ?? [];
        existing.push(task);
        byStage.set(task.stageId, existing);
      } else {
        unstaged.push(task);
      }
    }
    return [
      { id: "", name: "Unstaged", tasks: unstaged },
      ...stages.map((stage) => ({ id: stage.id, name: stage.name, tasks: byStage.get(stage.id) ?? [] })),
    ];
  }, [projectTasks, stages]);

  if (!project) {
    return (
      <Screen>
        <MobileHeader title="Project" back large={false} />
        <EmptyState
          icon={FolderKanban}
          title={projectQ.isLoading ? "Opening project" : "Project not found"}
          description={projectQ.isLoading ? "Fetching the latest details…" : "It may have been deleted."}
        />
      </Screen>
    );
  }

  const current = project;

  function persist(data: Parameters<typeof save.mutate>[0]["data"]) {
    save.mutate({ id: current.id, data });
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((stage) => stage.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    reorder.mutate({ projectId: current.id, ids });
  }

  function assignStage(task: Task, stageId: string | null) {
    const previous = task.stageId ?? null;
    saveTask.mutate({ id: task.id, data: { stageId } });
    showUndoToast("Stage updated", () => saveTask.mutate({ id: task.id, data: { stageId: previous } }));
    setMovingTask(null);
  }

  return (
    <Screen>
      <MobileHeader
        title={workspace?.name || "Project"}
        back
        large={false}
        actions={
          <Pressable
            onPress={() => {
              const completing = !project.completedAt;
              persist({ completedAt: completing ? new Date().toISOString() : "" });
              if (completing) showUndoToast("Project completed", () => persist({ completedAt: "" }));
            }}
            style={styles.done}
          >
            <Check size={16} color={colors.primaryForeground} />
            <Text style={styles.doneText}>{project.completedAt ? "Reopen" : "Done"}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <Field value={project.title} onChangeText={(title) => persist({ title })} autoCapitalize="words" />
        <Field
          value={project.description ?? ""}
          onChangeText={(description) => persist({ description })}
          placeholder="Description"
          multiline
          autoCapitalize="sentences"
        />
        <Pressable onPress={() => setPicker("status")} style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{project.status?.name || "None"}</Text>
        </Pressable>
        <Pressable onPress={() => setPicker("priority")} style={styles.card}>
          <Text style={styles.label}>Priority</Text>
          <Text style={styles.value}>{project.priorityLevel || "None"}</Text>
        </Pressable>
        <SectionLabel>Schedule</SectionLabel>
        <Pressable onPress={() => setPicker("start")} style={styles.card}>
          <Text style={styles.label}>Start</Text>
          <Text style={styles.value}>{project.startDate ? formatShortDate(project.startDate) : "Pick a date"}</Text>
        </Pressable>
        <Pressable onPress={() => setPicker("deadline")} style={styles.card}>
          <Text style={styles.label}>Deadline</Text>
          <Text style={styles.value}>{project.deadline ? formatShortDate(project.deadline) : "Pick a date"}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/(tabs)/tasks", params: { projectId: project.id } })}
          style={styles.card}
        >
          <Text style={styles.value}>Open tasks in this project</Text>
          <Text style={styles.meta}>{projectTasks.length} tasks</Text>
        </Pressable>
        <SectionLabel>Stages</SectionLabel>
        {stages.map((stage, index) => (
          <View key={stage.id} style={styles.stage}>
            {editingStage?.id === stage.id ? (
              <Field value={stageDraft} onChangeText={setStageDraft} autoCapitalize="words" />
            ) : (
              <Text style={styles.item}>{stage.name}</Text>
            )}
            <Pressable disabled={index === 0} onPress={() => moveStage(index, -1)}>
              <ChevronUp size={16} color={index === 0 ? colors.border : colors.mutedForeground} />
            </Pressable>
            <Pressable disabled={index === stages.length - 1} onPress={() => moveStage(index, 1)}>
              <ChevronDown size={16} color={index === stages.length - 1 ? colors.border : colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={() => {
                if (editingStage?.id === stage.id) {
                  if (stageDraft.trim()) {
                    renameStage.mutate({ projectId: project.id, stageId: stage.id, name: stageDraft.trim() });
                  }
                  setEditingStage(null);
                } else {
                  setEditingStage(stage);
                  setStageDraft(stage.name);
                }
              }}
            >
              <Text style={styles.link}>{editingStage?.id === stage.id ? "Save" : "Rename"}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert("Delete stage", "Tasks in this stage become unstaged.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deleteStage.mutate({ projectId: project.id, stageId: stage.id }),
                  },
                ])
              }
            >
              <Text style={styles.remove}>Delete</Text>
            </Pressable>
          </View>
        ))}
        <Field value={stageName} onChangeText={setStageName} placeholder="New stage" autoCapitalize="words" />
        <PrimaryButton
          label={project.doesHaveStages ? "Add stage" : "Enable stages"}
          disabled={project.doesHaveStages && !stageName.trim()}
          onPress={() => {
            if (!project.doesHaveStages) {
              persist({ doesHaveStages: true });
              return;
            }
            addStage.mutate({ projectId: project.id, name: stageName.trim() });
            setStageName("");
          }}
        />
        <SectionLabel>Board</SectionLabel>
        {projectTasks.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks" description="Assign tasks to this project from the task list." compact />
        ) : (
          board.map((column) => (
            <View key={column.id || "unstaged"} style={styles.column}>
              <View style={styles.head}>
                <Text style={styles.group}>{column.name}</Text>
                <Text style={styles.meta}>{column.tasks.length}</Text>
              </View>
              {column.tasks.map((task) => (
                <Pressable
                  key={task.id}
                  onPress={() => router.push(`/(app)/tasks/${task.id}`)}
                  onLongPress={() => setMovingTask(task)}
                  style={styles.task}
                >
                  <Text style={styles.item}>{task.name}</Text>
                  <Text style={styles.meta}>{task.status?.name || "Hold to move stage"}</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
        <PrimaryButton
          label={duplicate.isPending ? "Duplicating…" : "Duplicate project"}
          onPress={() =>
            void duplicate.mutateAsync(project.id).then((copy) => router.push(`/(app)/projects/${copy.id}`))
          }
        />
        <Pressable
          onPress={() =>
            Alert.alert("Delete project", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => remove.mutate(project.id, { onSuccess: () => router.replace("/(app)/projects") }),
              },
            ])
          }
          style={styles.delete}
        >
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete project</Text>
        </Pressable>
      </ScrollView>
      <BottomSheet open={picker === "status"} onClose={() => setPicker(null)} title="Status">
        <SheetOption
          selected={!project.statusId}
          onSelect={() => {
            persist({ statusId: "" });
            setPicker(null);
          }}
        >
          None
        </SheetOption>
        {(workspace?.status ?? []).map((status) => (
          <SheetOption
            key={status.id}
            selected={status.id === project.statusId}
            onSelect={() => {
              persist({ statusId: status.id });
              setPicker(null);
            }}
          >
            {status.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "priority"} onClose={() => setPicker(null)} title="Priority">
        <SheetOption
          selected={!project.priorityLevel}
          onSelect={() => {
            persist({ priorityLevel: "" });
            setPicker(null);
          }}
        >
          None
        </SheetOption>
        {PRIORITIES.map((priority) => (
          <SheetOption
            key={priority}
            selected={project.priorityLevel === priority}
            onSelect={() => {
              persist({ priorityLevel: priority });
              setPicker(null);
            }}
          >
            {priority}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={Boolean(movingTask)} onClose={() => setMovingTask(null)} title="Move to stage">
        <SheetOption selected={!movingTask?.stageId} onSelect={() => movingTask && assignStage(movingTask, null)}>
          Unstaged
        </SheetOption>
        {stages.map((stage) => (
          <SheetOption
            key={stage.id}
            selected={movingTask?.stageId === stage.id}
            onSelect={() => movingTask && assignStage(movingTask, stage.id)}
          >
            {stage.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        open={picker === "start" || picker === "deadline"}
        value={
          picker === "deadline" && project.deadline
            ? new Date(project.deadline)
            : picker === "start" && project.startDate
              ? new Date(project.startDate)
              : new Date()
        }
        mode="date"
        title={picker === "deadline" ? "Deadline" : "Start"}
        onClose={() => setPicker(null)}
        onChange={(next) => {
          const value = next ? toDateInputValue(next) : "";
          if (picker === "start") persist({ startDate: value });
          if (picker === "deadline") persist({ deadline: value });
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  done: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  doneText: { color: colors.primaryForeground, fontWeight: "600", fontSize: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  label: { color: colors.mutedForeground, fontSize: 12 },
  value: { color: colors.foreground, fontSize: 15, marginTop: 4 },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  stage: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  item: { flex: 1, color: colors.foreground },
  link: { color: colors.mutedForeground, fontWeight: "600" },
  remove: { color: colors.destructive, fontSize: 13 },
  column: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  group: { flex: 1, color: colors.foreground, fontWeight: "600" },
  task: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 20 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
}));
