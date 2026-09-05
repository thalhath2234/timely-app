import { useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Check, CircleDot, Clock, Flag, FolderKanban, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import {
  useAddBlock,
  useAddComment,
  useDeleteTask,
  useProjectsQuery,
  useSaveTask,
  useTaskActivityQuery,
  useTasksQuery,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { formatDuration, formatRelativeDay, formatShortDate, formatTimeRange, isOverdue, PRIORITY_META, PRIORITY_ORDER } from "../../../lib/format";
import { richToPlain, toRichContent } from "../../../lib/richText";
import { colors } from "../../../lib/theme";

type Picker = "status" | "priority" | "project" | "due" | "schedule" | null;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const tasks = useTasksQuery().data ?? [];
  const task = tasks.find((t) => t.id === id);
  const spaces = useWorkspacesQuery().data ?? [];
  const projects = useProjectsQuery().data ?? [];
  const save = useSaveTask();
  const remove = useDeleteTask();
  const addBlock = useAddBlock();
  const activity = useTaskActivityQuery(id);
  const comment = useAddComment();
  const [picker, setPicker] = useState<Picker>(null);
  const [note, setNote] = useState("");
  const [noteReady, setNoteReady] = useState(false);
  const [commentText, setCommentText] = useState("");

  const workspace = spaces.find((w) => w.id === task?.workspaceId);
  const scopedProjects = projects.filter((p) => p.workspaceId === task?.workspaceId);

  useMemo(() => {
    if (task && !noteReady) {
      setNote(richToPlain(task.descriptionRich) || task.description || "");
      setNoteReady(true);
    }
  }, [task, noteReady]);

  if (!task) {
    return (
      <Screen>
        <MobileHeader title="Task" back large={false} />
        <EmptyState icon={CircleDot} title="Task not found" description="It may have been deleted." />
      </Screen>
    );
  }

  const overdue = isOverdue(task.deadline, task.completedAt);

  function persist(data: Parameters<typeof save.mutate>[0]["data"]) {
    save.mutate({ id: task!.id, data });
  }

  return (
    <Screen>
      <MobileHeader
        title={task.project?.title || workspace?.name || "Task"}
        back
        large={false}
        actions={
          <Pressable
            onPress={() => persist({ completedAt: task.completedAt ? null : new Date().toISOString() })}
            style={styles.complete}
          >
            <Check size={16} color={colors.primaryForeground} />
            <Text style={styles.completeText}>{task.completedAt ? "Undo" : "Done"}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
        <Field value={task.name} onChangeText={(name) => persist({ name })} autoCapitalize="sentences" />
        <View style={styles.card}>
          <Row icon={<CircleDot size={16} color={colors.mutedForeground} />} label="Status" value={task.status?.name ?? "None"} onPress={() => setPicker("status")} />
          <Row icon={<Flag size={16} color={colors.mutedForeground} />} label="Priority" value={task.priorityLevel ? PRIORITY_META[task.priorityLevel]?.label ?? task.priorityLevel : "None"} onPress={() => setPicker("priority")} />
          <Row
            icon={<CalendarDays size={16} color={overdue ? colors.destructive : colors.mutedForeground} />}
            label="Due"
            value={task.deadline ? formatShortDate(task.deadline) : "No date"}
            tone={overdue ? colors.destructive : undefined}
            onPress={() => setPicker("due")}
          />
          <Row icon={<FolderKanban size={16} color={colors.mutedForeground} />} label="Project" value={task.project?.title ?? "None"} onPress={() => setPicker("project")} />
          <Row icon={<Clock size={16} color={colors.mutedForeground} />} label="Duration" value={formatDuration(task.duration) ?? "Not set"} />
        </View>
        <Text style={styles.section}>Scheduled</Text>
        {(task.blocks ?? []).map((block) => (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockText}>
              {formatRelativeDay(new Date(block.start))} · {formatTimeRange(block.start, block.end)}
            </Text>
          </View>
        ))}
        <PrimaryButton label="+ Add time" onPress={() => setPicker("schedule")} />
        <Text style={styles.section}>Notes</Text>
        <Field
          value={note}
          onChangeText={setNote}
          multiline
          autoCapitalize="sentences"
          placeholder="Write notes…"
        />
        <PrimaryButton
          label="Save notes"
          onPress={() => persist({ description: note, descriptionRich: toRichContent(undefined, note) })}
        />
        <Text style={styles.section}>Activity</Text>
        {(activity.data ?? []).map((row) => (
          <Text key={row.id} style={styles.activity}>
            {row.actorName} · {row.message}
          </Text>
        ))}
        <Field value={commentText} onChangeText={setCommentText} placeholder="Add a comment" autoCapitalize="sentences" />
        <PrimaryButton
          label="Comment"
          disabled={!commentText.trim()}
          onPress={() => {
            comment.mutate({ id: task.id, comment: commentText.trim() });
            setCommentText("");
          }}
        />
        <Pressable
          onPress={() =>
            Alert.alert("Delete task", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => remove.mutate(task.id, { onSuccess: () => router.replace("/(app)/(tabs)/tasks") }),
              },
            ])
          }
          style={styles.delete}
        >
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete task</Text>
        </Pressable>
      </ScrollView>

      <BottomSheet open={picker === "status"} onClose={() => setPicker(null)} title="Status">
        {(workspace?.status ?? []).map((s) => (
          <SheetOption key={s.id} selected={s.id === task.statusId} onSelect={() => { persist({ statusId: s.id }); setPicker(null); }}>
            {s.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "priority"} onClose={() => setPicker(null)} title="Priority">
        {PRIORITY_ORDER.map((p) => (
          <SheetOption key={p} selected={task.priorityLevel === p} onSelect={() => { persist({ priorityLevel: p }); setPicker(null); }}>
            {PRIORITY_META[p].label}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "project"} onClose={() => setPicker(null)} title="Project">
        <SheetOption selected={!task.projectId} onSelect={() => { persist({ projectId: null }); setPicker(null); }}>
          No project
        </SheetOption>
        {scopedProjects.map((p) => (
          <SheetOption key={p.id} selected={p.id === task.projectId} onSelect={() => { persist({ projectId: p.id }); setPicker(null); }}>
            {p.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        open={picker === "due" || picker === "schedule"}
        value={picker === "due" && task.deadline ? new Date(task.deadline) : new Date()}
        onClose={() => setPicker(null)}
        onChange={(next) => {
          if (picker === "due") persist({ deadline: next ? next.toISOString() : null });
          if (picker === "schedule" && next) {
            addBlock.mutate({ taskId: task.id, data: { start: next.toISOString(), durationMinutes: task.duration || 60 } });
          }
        }}
      />
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  tone?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tone ? { color: tone } : null]}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  complete: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 10,
    height: 32,
  },
  completeText: { color: colors.primaryForeground, fontSize: 13, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  rowLabel: { width: 72, color: colors.mutedForeground, fontSize: 13 },
  rowValue: { flex: 1, color: colors.foreground, fontSize: 15 },
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  block: { borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12 },
  blockText: { color: colors.foreground, fontSize: 14 },
  activity: { color: colors.mutedForeground, fontSize: 13 },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
});
