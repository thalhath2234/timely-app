import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bell, CalendarDays, Check, CircleDot, Clock, Flag, FolderKanban, ListTodo, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import TaskMetaEditor from "../../../components/ui/TaskMetaEditor";
import RecurrenceEditor from "../../../components/ui/RecurrenceEditor";
import { Dot, Field, PrimaryButton } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import { toCustomFieldDrafts } from "../../../lib/customFields";
import type { CustomFieldValueInput } from "../../../lib/types";
import {
  useAddBlock,
  useAddChecklistItem,
  useAddComment,
  useCreateTask,
  useDeleteChecklistItem,
  useDeleteTask,
  useDuplicateTask,
  useProjectsQuery,
  useSaveTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useTaskActivityQuery,
  useTaskQuery,
  useTasksQuery,
  useToggleChecklistItem,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { dateOnly, formatDuration, formatRelativeDay, formatShortDate, formatTime, formatTimeRange, isOverdue, localDateStamp, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../../lib/format";
import { normalizePriority } from "../../../lib/priority";
import { buildRecurrenceInput, rruleToDraft } from "../../../lib/recurrence";
import { richToPlain, toRichContent } from "../../../lib/richText";
import { colors } from "../../../lib/theme";

type Picker = "status" | "priority" | "project" | "workspace" | "stage" | "due" | "start" | "schedule" | "duration" | null;

function applyClock(day: Date, clock: Date) {
  const next = new Date(day);
  next.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return next;
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const tasks = useTasksQuery().data ?? [];
  const listed = tasks.find((t) => t.id === id);
  const fetched = useTaskQuery(id);
  const task = fetched.data ?? listed;
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
  const [checkTitle, setCheckTitle] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const addCheck = useAddChecklistItem();
  const toggleCheck = useToggleChecklistItem();
  const removeCheck = useDeleteChecklistItem();
  const createSubtask = useCreateTask();
  const duplicate = useDuplicateTask();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setTodayFocus = useSetTodayFocus();
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueInput[]>([]);
  const [metaWorkspaceId, setMetaWorkspaceId] = useState("");

  const workspace = spaces.find((w) => w.id === (task?.workspaceId || metaWorkspaceId));
  const scopedProjects = projects.filter((p) => p.workspaceId === (task?.workspaceId || metaWorkspaceId));
  const selectedProject = projects.find((p) => p.id === task?.projectId);
  const stages = [...(selectedProject?.stages ?? [])].sort((a, b) => a.order - b.order);
  const customFields = workspace?.customFields ?? [];

  useMemo(() => {
    if (task && !noteReady) {
      setNote(richToPlain(task.descriptionRich) || task.description || "");
      setNoteReady(true);
    }
  }, [task, noteReady]);

  useEffect(() => {
    if (!task) return;
    setLabelIds(task.labels?.map((label) => label.id) ?? task.labelIds?.map((label) => label.id) ?? []);
    setCustomFieldValues(toCustomFieldDrafts(customFields, task.customFieldValues ?? []));
    if (task.workspaceId) setMetaWorkspaceId(task.workspaceId);
    else if (!metaWorkspaceId && spaces[0]?.id) setMetaWorkspaceId(spaces[0].id);
  }, [task?.id, customFields.map((field) => field.id).join(","), spaces[0]?.id]);

  if (!task) {
    return (
      <Screen>
        <MobileHeader title="Task" back large={false} />
        {fetched.isLoading ? null : (
          <EmptyState icon={CircleDot} title="Task not found" description="It may have been deleted." />
        )}
      </Screen>
    );
  }

  const isInbox = task.kind === "inbox";
  const isReminder = task.kind === "reminder" || ((task.duration ?? 0) <= 0 && !isInbox && task.kind !== "task");
  const onToday = dateOnly(task.todayFocusOn) === localDateStamp();
  const recAnchor = task.scheduledOn
    ? new Date(task.scheduledOn)
    : task.recurrence?.dtstart
      ? new Date(task.recurrence.dtstart)
      : task.startDate
        ? new Date(task.startDate)
        : new Date();

  const overdue = isOverdue(task.deadline, task.completedAt);

  function persist(data: Parameters<typeof save.mutate>[0]["data"]) {
    const assigningMeta = Boolean(data.labelIds || data.customFieldValues);
    save.mutate({
      id: task!.id,
      data: {
        ...data,
        ...(!task!.workspaceId && assigningMeta && metaWorkspaceId ? { workspaceId: metaWorkspaceId } : {}),
      },
    });
  }

  return (
    <Screen>
      <MobileHeader
        title={isReminder ? "Reminder" : task.project?.title || workspace?.name || "Task"}
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
          {!isReminder ? (
          <Row
            icon={<CircleDot size={16} color={task.status?.color || colors.mutedForeground} />}
            label="Status"
            value={task.status?.name ?? "None"}
            swatch={task.status?.color}
            onPress={() => setPicker("status")}
          />
          ) : null}
          <Row icon={<Flag size={16} color={colors.mutedForeground} />} label="Priority" value={task.priorityLevel ? PRIORITY_META[task.priorityLevel]?.label ?? task.priorityLevel : "None"} onPress={() => setPicker("priority")} />
          {!isReminder ? (
            <>
              <Row icon={<FolderKanban size={16} color={colors.mutedForeground} />} label="Project" value={task.project?.title ?? "None"} onPress={() => setPicker("project")} />
              {stages.length > 0 ? (
                <Row
                  icon={<ListTodo size={16} color={colors.mutedForeground} />}
                  label="Stage"
                  value={stages.find((stage) => stage.id === task.stageId)?.name ?? "None"}
                  onPress={() => setPicker("stage")}
                />
              ) : null}
            </>
          ) : null}
          {isReminder && spaces.length > 0 ? (
          <Row
            icon={<FolderKanban size={16} color={colors.mutedForeground} />}
            label="Workspace"
            value={workspace?.name ?? "None"}
            onPress={() => setPicker("workspace")}
          />
          ) : null}
          <Row
            icon={<Clock size={16} color={colors.mutedForeground} />}
            label="Duration"
            value={isReminder ? "Reminder" : formatDuration(task.duration) ?? `${task.duration}m`}
            onPress={() => setPicker("duration")}
            action={
              isReminder ? (
                <Pressable onPress={() => persist({ duration: 30 })} hitSlop={8}>
                  <Text style={styles.rowAction}>Add duration</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => persist({ duration: 0 })}
                  hitSlop={8}
                  style={styles.reminderChip}
                >
                  <Bell size={12} color={colors.accentForeground} />
                  <Text style={styles.reminderChipText}>Reminder</Text>
                </Pressable>
              )
            }
          />
          <Row
            icon={<CalendarDays size={16} color={colors.mutedForeground} />}
            label="Start date"
            value={task.startDate ? formatShortDate(task.startDate) : "None"}
            onPress={() => setPicker("start")}
          />
          <Row
            icon={<CalendarDays size={16} color={overdue ? colors.destructive : colors.mutedForeground} />}
            label="Deadline"
            value={task.deadline ? formatShortDate(task.deadline) : "None"}
            tone={overdue ? colors.destructive : undefined}
            onPress={() => setPicker("due")}
          />
        </View>
        <RecurrenceEditor
          value={task.recurrence ? rruleToDraft(task.recurrence.rrule, recAnchor) : null}
          anchor={recAnchor}
          onChange={(draft) => {
            const recurrence = buildRecurrenceInput(draft, recAnchor);
            persist({
              recurrence,
              ...(recurrence && isReminder ? { scheduledOn: recurrence.dtstart } : {}),
            });
          }}
        />
        <TaskMetaEditor
          workspace={workspace}
          workspaceId={task.workspaceId || metaWorkspaceId}
          labelIds={labelIds}
          onLabelIds={(next) => {
            setLabelIds(next);
            persist({ labelIds: next.map((id) => ({ id })) });
          }}
          values={customFieldValues}
          onValues={(next) => {
            setCustomFieldValues(next);
            persist({ customFieldValues: next });
          }}
        />
        <Text style={styles.section}>Schedule</Text>
        {isReminder || task.recurrence ? (
          <>
            <Pressable onPress={() => setPicker("schedule")} style={styles.block}>
              <Text style={styles.blockText}>
                {task.scheduledOn || task.recurrence?.dtstart
                  ? `Time · ${formatTime(task.scheduledOn ?? task.recurrence!.dtstart)}`
                  : "Pick a time"}
              </Text>
            </Pressable>
            <Text style={styles.activity}>
              {task.recurrence
                ? isReminder
                  ? "Each repeat pings at this time and does not reserve a work block."
                  : "Each occurrence starts at this time; auto-schedule will not give the block to other tasks."
                : task.scheduledOn
                  ? `Pings at ${formatTime(task.scheduledOn)}. Use start date for the day.`
                  : "Pick a time to show this reminder on the calendar. Use start date for the day."}
            </Text>
          </>
        ) : (
          <>
            {(task.blocks ?? []).map((block) => (
              <View key={block.id} style={styles.block}>
                <Text style={styles.blockText}>
                  {formatRelativeDay(new Date(block.start))} · {formatTimeRange(block.start, block.end)}
                </Text>
              </View>
            ))}
            <PrimaryButton label="+ Add time" onPress={() => setPicker("schedule")} />
          </>
        )}
        <Text style={styles.section}>Focus</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <PrimaryButton
            label={task.focusStartedAt ? "Stop focus" : "Start focus"}
            onPress={() =>
              task.focusStartedAt
                ? void stopFocus.mutateAsync(task.id)
                : void startFocus.mutateAsync(task.id)
            }
          />
          <PrimaryButton
            label={onToday ? "Remove from Today" : "Add to Today"}
            onPress={() =>
              void setTodayFocus.mutateAsync({
                id: task.id,
                date: onToday ? null : localDateStamp(),
              })
            }
          />
          <PrimaryButton
            label="Duplicate"
            onPress={() =>
              void duplicate.mutateAsync(task.id).then((copy) => router.push(`/(app)/tasks/${copy.id}`))
            }
          />
        </View>
        {(task.actualMinutes ?? 0) > 0 ? (
          <Text style={styles.activity}>{task.actualMinutes}m actually focused</Text>
        ) : null}
        {isInbox ? (
          <>
            <Text style={styles.section}>Clarify inbox item</Text>
            <PrimaryButton
              label="Make a 30m task"
              onPress={() =>
                persist({
                  kind: "task",
                  duration: 30,
                  workspaceId: metaWorkspaceId || spaces[0]?.id,
                })
              }
            />
            <PrimaryButton
              label="Make a reminder in 1 hour"
              onPress={() =>
                persist({
                  kind: "reminder",
                  duration: 0,
                  scheduledOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                })
              }
            />
          </>
        ) : null}
        <Text style={styles.section}>Checklist</Text>
        {(task.checklist ?? []).map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              void toggleCheck.mutateAsync({
                id: task.id,
                itemId: item.id,
                completed: !item.completedAt,
              })
            }
            onLongPress={() => void removeCheck.mutateAsync({ id: task.id, itemId: item.id })}
            style={{ paddingVertical: 6 }}
          >
            <Text style={{ color: item.completedAt ? colors.mutedForeground : colors.foreground }}>
              {item.completedAt ? "☑" : "☐"} {item.title}
            </Text>
          </Pressable>
        ))}
        <Field value={checkTitle} onChangeText={setCheckTitle} placeholder="Add checklist item" />
        <PrimaryButton
          label="Add item"
          onPress={() => {
            const title = checkTitle.trim();
            if (!title) return;
            void addCheck.mutateAsync({ id: task.id, title }).then(() => setCheckTitle(""));
          }}
        />
        {!task.parentTaskId ? (
          <>
            <Text style={styles.section}>
              Subtasks{task.openSubtaskCount ? ` (${task.openSubtaskCount} open)` : ""}
            </Text>
            {(task.subtasks ?? []).map((child) => (
              <Pressable key={child.id} onPress={() => router.push(`/(app)/tasks/${child.id}`)} style={{ paddingVertical: 6 }}>
                <Text style={{ color: colors.foreground }}>{child.completedAt ? "☑" : "☐"} {child.name}</Text>
              </Pressable>
            ))}
            <Field value={subtaskTitle} onChangeText={setSubtaskTitle} placeholder="Add subtask" />
            <PrimaryButton
              label="Add subtask"
              onPress={() => {
                const name = subtaskTitle.trim();
                if (!name) return;
                void createSubtask
                  .mutateAsync({
                    name,
                    parentTaskId: task.id,
                    duration: 30,
                    workspaceId: task.workspaceId ?? undefined,
                  })
                  .then(() => setSubtaskTitle(""));
              }}
            />
          </>
        ) : null}
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
          <SheetOption
            key={s.id}
            selected={s.id === task.statusId}
            leading={<Dot color={s.color} />}
            onSelect={() => { persist({ statusId: s.id }); setPicker(null); }}
          >
            {s.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "priority"} onClose={() => setPicker(null)} title="Priority">
        {PRIORITY_ORDER.map((p) => (
          <SheetOption
            key={p}
            selected={normalizePriority(task.priorityLevel) === p}
            onSelect={() => { persist({ priorityLevel: p }); setPicker(null); }}
          >
            {PRIORITY_META[p].label}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "workspace"} onClose={() => setPicker(null)} title="Workspace">
        {spaces.map((space) => (
          <SheetOption
            key={space.id}
            selected={space.id === metaWorkspaceId}
            onSelect={() => {
              setMetaWorkspaceId(space.id);
              persist({ workspaceId: space.id });
              setPicker(null);
            }}
          >
            {space.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "project"} onClose={() => setPicker(null)} title="Project">
        <SheetOption selected={!task.projectId} onSelect={() => { persist({ projectId: null }); setPicker(null); }}>
          No project
        </SheetOption>
        {scopedProjects.map((p) => (
          <SheetOption key={p.id} selected={p.id === task.projectId} onSelect={() => { persist({ projectId: p.id, stageId: null }); setPicker(null); }}>
            {p.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "stage"} onClose={() => setPicker(null)} title="Stage">
        <SheetOption selected={!task.stageId} onSelect={() => { persist({ stageId: null }); setPicker(null); }}>
          No stage
        </SheetOption>
        {stages.map((stage) => (
          <SheetOption
            key={stage.id}
            selected={stage.id === task.stageId}
            onSelect={() => { persist({ stageId: stage.id }); setPicker(null); }}
          >
            {stage.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "duration"} onClose={() => setPicker(null)} title="Duration">
        <SheetOption
          selected={task.duration <= 0}
          onSelect={() => {
            persist({ duration: 0 });
            setPicker(null);
          }}
        >
          Reminder
        </SheetOption>
        {[15, 30, 45, 60, 90, 120].map((minutes) => (
          <SheetOption
            key={minutes}
            selected={task.duration === minutes}
            onSelect={() => {
              persist({ duration: minutes });
              setPicker(null);
            }}
          >
            {formatDuration(minutes) ?? `${minutes}m`}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        open={picker === "due" || picker === "start" || picker === "schedule"}
        value={
          picker === "due" && task.deadline
            ? new Date(task.deadline)
            : picker === "start" && task.startDate
              ? new Date(task.startDate)
              : picker === "schedule" && (task.scheduledOn || task.recurrence?.dtstart)
                ? new Date(task.scheduledOn ?? task.recurrence!.dtstart)
                : new Date()
        }
        mode={
          picker === "due" || picker === "start"
            ? "date"
            : isReminder || Boolean(task.recurrence)
              ? "time"
              : "datetime"
        }
        title={picker === "due" ? "Deadline" : picker === "start" ? "Start date" : isReminder || task.recurrence ? "Time" : "Schedule"}
        onClose={() => setPicker(null)}
        onChange={(next) => {
          if (picker === "due") persist({ deadline: next ? toDateInputValue(next) : null });
          if (picker === "start") {
            if (!next) {
              persist({ startDate: null });
              return;
            }
            const timeOnly = isReminder && !task.recurrence;
            persist({
              startDate: toDateInputValue(next),
              ...(timeOnly && task.scheduledOn
                ? { scheduledOn: applyClock(next, new Date(task.scheduledOn)).toISOString() }
                : {}),
            });
          }
          if (picker === "schedule" && next) {
            if (isReminder || task.recurrence) {
              const day = task.scheduledOn
                ? new Date(task.scheduledOn)
                : task.startDate
                  ? new Date(task.startDate)
                  : new Date();
              persist({ scheduledOn: applyClock(day, next).toISOString() });
            } else {
              addBlock.mutate({ taskId: task.id, data: { start: next.toISOString(), durationMinutes: task.duration } });
            }
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
  swatch,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  tone?: string;
  swatch?: string | null;
  action?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      {swatch ? <Dot color={swatch} /> : null}
      <Text style={[styles.rowValue, tone ? { color: tone } : null]}>{value}</Text>
      {action}
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
  rowAction: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  reminderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reminderChipText: { color: colors.accentForeground, fontSize: 12, fontWeight: "600" },
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  block: { borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12 },
  blockText: { color: colors.foreground, fontSize: 14 },
  activity: { color: colors.mutedForeground, fontSize: 13 },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
});
