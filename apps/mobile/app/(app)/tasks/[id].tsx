import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ban, CalendarDays, Check, CircleDot, Clock, Flag, FolderKanban, ListTodo, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import TaskMetaEditor from "../../../components/ui/TaskMetaEditor";
import RecurrenceEditor from "../../../components/ui/RecurrenceEditor";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import { Dot, Chip, Field, PrimaryButton } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import RichTextEditor from "../../../components/editor/RichTextEditor";
import { toCustomFieldDrafts } from "../../../lib/customFields";
import type { CustomFieldValueInput, DocContent } from "../../../lib/types";
import {
  useAddBlock,
  useAddChecklistItem,
  useAddComment,
  useCreateTask,
  useDeleteChecklistItem,
  useDeleteTask,
  useDuplicateTask,
  useApplySchedule,
  usePinBlock,
  usePinTask,
  useProjectsQuery,
  useSaveTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useTaskActivityQuery,
  useTaskQuery,
  useTasksQuery,
  useToggleChecklistItem,
  useClearTaskBlocks,
  useDeleteBlock,
  useSplitTaskSeries,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { dateOnly, formatDuration, formatRelativeDay, formatShortDate, formatTime, formatTimeRange, isOverdue, localDateStamp, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../../lib/format";
import { normalizePriority } from "../../../lib/priority";
import { buildRecurrenceInput, rruleToDraft } from "../../../lib/recurrence";
import { richToPlain, toRichContent, isRichContentEmpty } from "../../../lib/richText";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { useDraftText } from "../../../lib/draftText";
import { useAutosave } from "../../../lib/autosave";
import type { UpdateTaskPayload } from "../../../lib/api/tasks";

type Picker = "status" | "priority" | "project" | "workspace" | "stage" | "due" | "start" | "schedule" | "duration" | "earliest" | "blocked" | "scope" | null;

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
  const metaRef = useRef({ taskWorkspaceId: "", metaWorkspaceId: "" });
  const { schedule: scheduleSave, flush: flushSave } = useAutosave<UpdateTaskPayload>(async (data) => {
    if (!id) return;
    const assigningMeta = Boolean(data.labelIds || data.customFieldValues);
    await save.mutateAsync({
      id,
      data: {
        ...data,
        ...(!metaRef.current.taskWorkspaceId && assigningMeta && metaRef.current.metaWorkspaceId
          ? { workspaceId: metaRef.current.metaWorkspaceId }
          : {}),
      },
    });
  });
  const remove = useDeleteTask();
  const addBlock = useAddBlock();
  const pinTask = usePinTask();
  const pinBlock = usePinBlock();
  const applySchedule = useApplySchedule();
  const clearBlocks = useClearTaskBlocks();
  const removeBlock = useDeleteBlock();
  const splitSeries = useSplitTaskSeries();
  const activity = useTaskActivityQuery(id);
  const comment = useAddComment();
  const [picker, setPicker] = useState<Picker>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [note, setNote] = useState("");
  const [noteRich, setNoteRich] = useState<DocContent>({ type: "doc", content: [{ type: "paragraph" }] });
  const [noteReady, setNoteReady] = useState(false);
  const [noteSync, setNoteSync] = useState(0);
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
  const [scope, setScope] = useState<"this" | "future" | "all">("all");
  const [blockQuery, setBlockQuery] = useState("");
  const [name, setName] = useDraftText(task?.name, id);
  const [preferStart, setPreferStart] = useDraftText(task?.preferredWindows?.[0]?.start, id);
  const [preferEnd, setPreferEnd] = useDraftText(task?.preferredWindows?.[0]?.end, id);
  metaRef.current = { taskWorkspaceId: task?.workspaceId ?? "", metaWorkspaceId };

  const workspace = spaces.find((w) => w.id === (task?.workspaceId || metaWorkspaceId));
  const scopedProjects = projects.filter((p) => p.workspaceId === (task?.workspaceId || metaWorkspaceId));
  const selectedProject = projects.find((p) => p.id === task?.projectId);
  const stages = [...(selectedProject?.stages ?? [])].sort((a, b) => a.order - b.order);
  const customFields = workspace?.customFields ?? [];

  useMemo(() => {
    if (task && !noteReady) {
      const seed = !isRichContentEmpty(task.descriptionRich)
        ? task.descriptionRich!
        : toRichContent(undefined, task.description || "");
      setNote(richToPlain(seed) || task.description || "");
      setNoteRich(seed.type ? seed : { type: "doc", content: [{ type: "paragraph" }] });
      setNoteSync((value) => value + 1);
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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
        <Field
          value={name}
          onChangeText={(next) => {
            setName(next);
            scheduleSave({ name: next });
          }}
          onBlur={() => void flushSave()}
          placeholder="Title"
          autoCapitalize="sentences"
        />
        <View style={{ gap: 8 }}>
          <SegmentedControl
            options={[
              { label: "Work", value: "task" },
              { label: "Reminder", value: "reminder" },
            ]}
            value={isInbox ? null : isReminder ? "reminder" : "task"}
            onChange={(next) => {
              if (next === "reminder") {
                persist({
                  kind: "reminder",
                  duration: 0,
                  scheduledOn: task.scheduledOn || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                });
                return;
              }
              persist({
                kind: "task",
                duration: Math.max(30, task.duration || 0) || 30,
                workspaceId: task.workspaceId || metaWorkspaceId || spaces[0]?.id,
              });
            }}
          />
          <Text style={styles.activity}>
            {isInbox
              ? "Assign a workspace to put this on the board, or choose Reminder for a ping."
              : isReminder
                ? "Pings at a chosen time. Does not reserve a work block."
                : "Estimated minutes of work the scheduler can place."}
          </Text>
        </View>
        <View style={styles.card}>
          {!isReminder ? (
          <Row
            icon={<FolderKanban size={16} color={colors.mutedForeground} />}
            label="Workspace"
            value={workspace?.name ?? "Select workspace"}
            onPress={() => setPicker("workspace")}
          />
          ) : null}
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
              <Row icon={<ListTodo size={16} color={colors.mutedForeground} />} label="Project" value={task.project?.title ?? "None"} onPress={() => setPicker("project")} />
              <Row
                icon={<Ban size={16} color={colors.mutedForeground} />}
                label="Blocked by"
                value={tasks.find((item) => item.id === task.blockedById)?.name ?? task.blockedBy?.name ?? "None"}
                onPress={() => setPicker("blocked")}
              />
              {tasks.some((item) => item.blockedById === task.id) ? (
                <Text style={styles.activity}>
                  Waiting on this: {tasks.filter((item) => item.blockedById === task.id).map((item) => item.name).join(", ")}
                </Text>
              ) : null}
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
          {!isReminder && !isInbox ? (
          <Row
            icon={<Clock size={16} color={colors.mutedForeground} />}
            label="Duration"
            value={formatDuration(task.duration) ?? `${task.duration}m`}
            onPress={() => setPicker("duration")}
          />
          ) : null}
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
        {task.recurrence ? (
          <Pressable onPress={() => setPicker("scope")} style={styles.block}>
            <Text style={styles.blockText}>
              Edits apply to {scope === "this" ? "this occurrence" : scope === "future" ? "this and following" : "the entire series"}
            </Text>
          </Pressable>
        ) : null}
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
            scheduleSave({ customFieldValues: next });
          }}
        />
        <Text style={styles.section}>{isReminder ? "Reminder" : "Schedule"}</Text>
        {isReminder || task.recurrence ? (
          <>
            <Pressable onPress={() => setPicker("schedule")} style={styles.block}>
              <Text style={styles.blockText}>
                {task.scheduledOn || task.recurrence?.dtstart
                  ? isReminder && !task.recurrence
                    ? `Notify · ${formatRelativeDay(new Date(task.scheduledOn!))} · ${formatTime(task.scheduledOn!)}`
                    : `Time · ${formatTime(task.scheduledOn ?? task.recurrence!.dtstart)}`
                  : "Pick a time"}
              </Text>
            </Pressable>
            <Text style={styles.activity}>
              {task.recurrence
                ? isReminder
                  ? "Each repeat pings at this time and does not reserve a work block."
                  : "Each occurrence starts at this time; auto-schedule will not give the block to other tasks."
                : task.scheduledOn
                  ? `Pings at ${formatRelativeDay(new Date(task.scheduledOn))} · ${formatTime(task.scheduledOn)}. Does not reserve a work block.`
                  : "Pick a date and time to ping. This does not reserve a work block."}
            </Text>
          </>
        ) : (
          <>
            {(task.blocks ?? []).map((block) => (
              <View key={block.id} style={styles.block}>
                <Text style={styles.blockText}>
                  {formatRelativeDay(new Date(block.start))} · {formatTimeRange(block.start, block.end)}
                  {block.locked || block.source === "manual" ? " · pinned" : ""}
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {block.source === "engine" && !block.locked ? (
                    <Pressable onPress={() => pinBlock.mutate({ blockId: block.id, locked: true })} hitSlop={8}>
                      <Text style={styles.rowAction}>Pin</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      setConfirm({
                        title: "Delete this time?",
                        message: "This reserved block will be removed.",
                        onConfirm: () => removeBlock.mutate(block.id),
                      })
                    }
                    hitSlop={8}
                  >
                    <Text style={[styles.rowAction, { color: colors.destructive }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            <PrimaryButton label="+ Add time" onPress={() => setPicker("schedule")} />
            {(task.blocks ?? []).length > 0 ? (
              <Pressable
                onPress={() =>
                  setConfirm({
                    title: "Clear all reserved time?",
                    message: "Every work block on this task will be removed.",
                    confirmLabel: "Clear",
                    onConfirm: () => clearBlocks.mutate(task.id),
                  })
                }
              >
                <Text style={[styles.rowAction, { color: colors.destructive }]}>Clear all time</Text>
              </Pressable>
            ) : null}
            {!isInbox ? (
              <>
                <PrimaryButton
                  label={applySchedule.isPending ? "Scheduling…" : "Auto-schedule this task"}
                  disabled={applySchedule.isPending}
                  onPress={() => applySchedule.mutate({ taskIds: [task.id] })}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Chip
                    label={task.scheduleLocked ? "Pinned" : "Pin task"}
                    active={Boolean(task.scheduleLocked)}
                    onPress={() => pinTask.mutate({ taskId: task.id, locked: !task.scheduleLocked })}
                  />
                  <Chip
                    label="One sitting"
                    active={Boolean(task.contiguous)}
                    onPress={() => persist({ contiguous: !task.contiguous })}
                  />
                </View>
                <Text style={styles.activity}>Min chunk</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {[15, 30, 45, 60].map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes}m`}
                      active={(task.minChunkMinutes ?? 15) === minutes}
                      onPress={() => persist({ minChunkMinutes: minutes })}
                    />
                  ))}
                </View>
                <Text style={styles.activity}>Preferred chunk</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Chip
                    label="Any"
                    active={task.preferredChunkMinutes == null}
                    onPress={() => persist({ preferredChunkMinutes: null })}
                  />
                  {[30, 60, 90].map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes}m`}
                      active={task.preferredChunkMinutes === minutes}
                      onPress={() => persist({ preferredChunkMinutes: minutes })}
                    />
                  ))}
                </View>
                <Pressable onPress={() => setPicker("earliest")} style={styles.block}>
                  <Text style={styles.blockText}>
                    {task.earliestStartAt
                      ? `Earliest · ${formatRelativeDay(new Date(task.earliestStartAt))} ${formatTime(task.earliestStartAt)}`
                      : "Earliest start · any time"}
                  </Text>
                </Pressable>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={preferStart}
                      onChangeText={(start) => {
                        setPreferStart(start);
                        const end = preferEnd;
                        scheduleSave({
                          preferredWindows: start && end ? [{ start, end }] : start ? [{ start, end: start }] : [],
                        });
                      }}
                      onBlur={() => void flushSave()}
                      placeholder="Prefer from (09:00)"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={preferEnd}
                      onChangeText={(end) => {
                        setPreferEnd(end);
                        const start = preferStart;
                        scheduleSave({ preferredWindows: start && end ? [{ start, end }] : [] });
                      }}
                      onBlur={() => void flushSave()}
                      placeholder="Prefer to (12:00)"
                    />
                  </View>
                </View>
              </>
            ) : null}
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
                    duration: task.duration > 0 ? task.duration : 30,
                    kind: "task",
                    workspaceId: task.workspaceId || task.workspace?.id || undefined,
                    projectId: task.projectId || task.project?.id || undefined,
                    statusId: task.statusId || task.status?.id || undefined,
                    stageId: task.stageId || undefined,
                    priorityLevel: task.priorityLevel || undefined,
                  })
                  .then(() => setSubtaskTitle(""));
              }}
            />
          </>
        ) : null}
        <Text style={styles.section}>Notes</Text>
        <RichTextEditor
          compact
          content={isRichContentEmpty(noteRich) ? { type: "doc", content: [{ type: "paragraph" }] } : noteRich}
          syncKey={noteSync}
          placeholder="Write notes. Type '/' for blocks…"
          onChange={({ content, plainText }) => {
            setNoteRich(content);
            setNote(plainText);
          }}
        />
        <PrimaryButton
          label="Save notes"
          onPress={() => persist({ description: note, descriptionRich: noteRich })}
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
            setConfirm({
              title: "Delete task",
              message: "This cannot be undone.",
              onConfirm: () => remove.mutate(task.id, { onSuccess: () => router.replace("/(app)/(tabs)/tasks") }),
            })
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
            selected={space.id === (task.workspaceId || metaWorkspaceId)}
            onSelect={() => {
              setMetaWorkspaceId(space.id);
              persist(
                isInbox
                  ? { workspaceId: space.id, kind: "task", duration: Math.max(30, task.duration || 0) || 30 }
                  : { workspaceId: space.id },
              );
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
          <SheetOption
            key={p.id}
            selected={p.id === task.projectId}
            onSelect={() => {
              persist(
                isInbox
                  ? {
                      projectId: p.id,
                      stageId: null,
                      kind: "task",
                      duration: Math.max(30, task.duration || 0) || 30,
                      workspaceId: p.workspaceId || metaWorkspaceId || spaces[0]?.id,
                    }
                  : { projectId: p.id, stageId: null },
              );
              setPicker(null);
            }}
          >
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
      <BottomSheet open={picker === "blocked"} onClose={() => setPicker(null)} title="Blocked by">
        <Field value={blockQuery} onChangeText={setBlockQuery} placeholder="Search tasks" />
        <SheetOption
          selected={!task.blockedById}
          onSelect={() => {
            persist({ blockedById: null });
            setPicker(null);
          }}
        >
          None
        </SheetOption>
        {tasks
          .filter((item) => item.id !== task.id && item.kind !== "inbox" && item.blockedById !== task.id)
          .filter((item) => !task.workspaceId || item.workspaceId === task.workspaceId)
          .filter((item) => !blockQuery.trim() || item.name.toLowerCase().includes(blockQuery.trim().toLowerCase()))
          .slice(0, 30)
          .map((item) => (
            <SheetOption
              key={item.id}
              selected={item.id === task.blockedById}
              onSelect={() => {
                persist({ blockedById: item.id });
                setPicker(null);
                setBlockQuery("");
              }}
            >
              {item.name}
            </SheetOption>
          ))}
      </BottomSheet>
      <BottomSheet open={picker === "scope"} onClose={() => setPicker(null)} title="Edit series">
        <SheetOption
          selected={scope === "this"}
          onSelect={() => {
            setScope("this");
            setPicker(null);
          }}
        >
          This occurrence
        </SheetOption>
        <SheetOption
          selected={scope === "future"}
          onSelect={() => {
            setScope("future");
            setPicker(null);
            const fromStart = task.scheduledOn ?? task.recurrence?.dtstart;
            if (fromStart) void splitSeries.mutateAsync({ id: task.id, fromStart });
          }}
        >
          This and following
        </SheetOption>
        <SheetOption
          selected={scope === "all"}
          onSelect={() => {
            setScope("all");
            setPicker(null);
          }}
        >
          Entire series
        </SheetOption>
      </BottomSheet>
      <BottomSheet open={picker === "duration"} onClose={() => setPicker(null)} title="Duration">
        {[15, 30, 45, 60, 90, 120].map((minutes) => (
          <SheetOption
            key={minutes}
            selected={task.duration === minutes}
            onSelect={() => {
              persist({ kind: "task", duration: minutes });
              setPicker(null);
            }}
          >
            {formatDuration(minutes) ?? `${minutes}m`}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        open={picker === "due" || picker === "start" || picker === "schedule" || picker === "earliest"}
        value={
          picker === "due" && task.deadline
            ? new Date(task.deadline)
            : picker === "start" && task.startDate
              ? new Date(task.startDate)
              : picker === "earliest" && task.earliestStartAt
                ? new Date(task.earliestStartAt)
              : picker === "schedule" && (task.scheduledOn || task.recurrence?.dtstart)
                ? new Date(task.scheduledOn ?? task.recurrence!.dtstart)
                : new Date()
        }
        mode={
          picker === "due" || picker === "start"
            ? "date"
            : picker === "earliest"
              ? "datetime"
              : picker === "schedule" && isReminder && !task.recurrence
                ? "datetime"
              : isReminder || Boolean(task.recurrence)
                ? "time"
                : "datetime"
        }
        title={
          picker === "due"
            ? "Deadline"
            : picker === "start"
              ? "Start date"
              : picker === "earliest"
                ? "Earliest start"
                : isReminder
                  ? "Notify at"
                  : task.recurrence
                    ? "Time"
                    : "Schedule"
        }
        onClose={() => setPicker(null)}
        onChange={(next) => {
          if (picker === "due") persist({ deadline: next ? toDateInputValue(next) : null });
          if (picker === "start") {
            if (!next) {
              persist({ startDate: null });
              return;
            }
            persist({
              startDate: toDateInputValue(next),
            });
          }
          if (picker === "earliest") persist({ earliestStartAt: next ? next.toISOString() : null });
          if (picker === "schedule" && next) {
            if (isReminder && !task.recurrence) {
              persist({ scheduledOn: next.toISOString() });
            } else if (isReminder || task.recurrence) {
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
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
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

const styles = createThemedStyleSheet((colors) => ({
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
}));
