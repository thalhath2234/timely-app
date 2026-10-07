import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ban, CalendarDays, Check, CircleDot, Clock, Copy, Flag, FolderKanban, History, ListChecks, ListTodo, Pin, Play, Plus, Sparkles, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import TaskMetaEditor from "../../../components/ui/TaskMetaEditor";
import RecurrenceEditor from "../../../components/ui/RecurrenceEditor";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import { Chip, Dot, Field, PrimaryButton, PropertyGroup, PropertyRow } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import DescriptionCard from "../../../components/editor/DescriptionCard";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import TaskSectionHeader from "../../../components/tasks/TaskSectionHeader";
import { toCustomFieldDrafts } from "../../../lib/customFields";
import type { CustomFieldValueInput, DocContent } from "../../../lib/types";
import {
  useAddBlock,
  useAddChecklistItem,
  useAddComment,
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
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { dateOnly, formatDuration, formatRelativeDay, formatShortDate, formatTime, formatTimeRange, localDateStamp, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../../lib/format";
import { normalizePriority } from "../../../lib/priority";
import { buildRecurrenceInput, rruleToDraft } from "../../../lib/recurrence";
import { richToPlain, toRichContent, isRichContentEmpty } from "../../../lib/richText";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { useDraftText } from "../../../lib/draftText";
import { useAutosave } from "../../../lib/autosave";
import type { UpdateTaskPayload } from "../../../lib/api/tasks";

type Picker = "status" | "priority" | "project" | "workspace" | "stage" | "due" | "start" | "schedule" | "duration" | "earliest" | "blocked" | "scope" | "preferStart" | "preferEnd" | null;

function applyClock(day: Date, clock: Date) {
  const next = new Date(day);
  next.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return next;
}

function padClock(n: number) {
  return String(n).padStart(2, "0");
}

function formatClockValue(date: Date) {
  return `${padClock(date.getHours())}:${padClock(date.getMinutes())}`;
}

function parseClockDate(value: string, fallbackHour: number) {
  const next = new Date();
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    next.setHours(fallbackHour, 0, 0, 0);
    return next;
  }
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return next;
}

function clockLabel(value: string) {
  if (!value.trim()) return "Any";
  return formatTime(parseClockDate(value, 9).toISOString());
}

function clockMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function preferredWindowsPayload(start: string, end: string) {
  const startMin = clockMinutes(start);
  const endMin = clockMinutes(end);
  if (startMin == null || endMin == null || endMin <= startMin) return [];
  return [{ start, end }];
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
  const workingHoursZone = useWorkingHoursZone();
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
  const [assistantSelection, setAssistantSelection] = useState("");
  const [note, setNote] = useState("");
  const [noteRich, setNoteRich] = useState<DocContent>({ type: "doc", content: [{ type: "paragraph" }] });
  const [noteReady, setNoteReady] = useState(false);
  const [noteSync, setNoteSync] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [childTitle, setChildTitle] = useState("");
  const addCheck = useAddChecklistItem();
  const toggleCheck = useToggleChecklistItem();
  const removeCheck = useDeleteChecklistItem();
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
  const [scheduleError, setScheduleError] = useState<string | null>(null);
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

  useAssistantScreen(task ? [
    contextChip("object", name || "Task", `tasks/${task.id}`),
    ...(assistantSelection ? [contextChip("selection", "Selected text", assistantSelection)] : []),
    contextChip("workspace", "Workspace", task.workspaceId),
    ...(task.projectId ? [contextChip("project", "Project", task.projectId)] : []),
    ...(name !== task.name || note !== (task.description || "") ? [contextChip("draft", "Unsaved task text", { name, description: note })] : []),
  ] : []);
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
  const isInactive = Boolean(
    task.completedAt ||
      task.blockedById ||
      /done|complete|blocked|cancelled|canceled/i.test(task.status?.name ?? ""),
  );
  const onToday = dateOnly(task.todayFocusOn) === localDateStamp();
  const recAnchor = task.scheduledOn
    ? new Date(task.scheduledOn)
    : task.recurrence?.dtstart
      ? new Date(task.recurrence.dtstart)
      : task.startDate
        ? new Date(task.startDate)
        : new Date();

  const overdue = isOverdue(task, todayInZone(workingHoursZone));
  const checklist = task.checklist ?? [];
  const checklistDone = checklist.filter((item) => item.completedAt).length;
  const combinedDone = checklistDone;
  const combinedTotal = checklist.length;
  const combinedProgress = combinedTotal ? combinedDone / combinedTotal : 0;

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
        title="Timely"
        subtitle={`TASK-${task.id.slice(-4).toUpperCase()}${isReminder ? "  ·  REMINDER" : ""}`}
        back
        large={false}
        statusDot
        actions={
          <Pressable
            onPress={() => persist({ completedAt: task.completedAt ? "" : new Date().toISOString() })}
            style={styles.complete}
          >
            <Check size={16} color={colors.primaryForeground} />
            <Text style={styles.completeText}>{task.completedAt ? "Undo" : "Done"}</Text>
          </Pressable>
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.objectiveCard}>
          <Text style={styles.eyebrow}>{isReminder ? "TITLE" : "TASK OBJECTIVE"}</Text>
          <Field
            bare
            multiline
            autoGrow
            value={name}
            onChangeText={(next) => {
              setName(next);
              scheduleSave({ name: next });
            }}
            onBlur={() => void flushSave()}
            placeholder="Title"
            autoCapitalize="sentences"
          />
        </View>
        <DescriptionCard
            onSelectionChange={setAssistantSelection}
            content={isRichContentEmpty(noteRich) ? { type: "doc", content: [{ type: "paragraph" }] } : noteRich}
            syncKey={noteSync}
            placeholder="Add context, links, acceptance criteria, or notes…"
            onChange={({ content, plainText }) => {
              setNoteRich(content);
              setNote(plainText);
            }}
            onSave={() => persist({ description: note, descriptionRich: noteRich })}
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
        <PropertyGroup tone="card">
          {!isReminder ? (
          <PropertyRow
            icon={<FolderKanban size={16} color={colors.mutedForeground} />}
            label="Workspace"
            value={workspace?.name ?? "Select workspace"}
            onPress={() => setPicker("workspace")}
          />
          ) : null}
          {!isReminder ? (
          <PropertyRow
            icon={<CircleDot size={16} color={task.status?.color || colors.mutedForeground} />}
            label="Status"
            value={task.status?.name ?? "None"}
            swatch={task.status?.color}
            onPress={() => setPicker("status")}
          />
          ) : null}
          <PropertyRow icon={<Flag size={16} color={colors.mutedForeground} />} label="Priority" value={task.priorityLevel ? PRIORITY_META[task.priorityLevel]?.label ?? task.priorityLevel : "None"} onPress={() => setPicker("priority")} />
          {!isReminder ? (
            <>
              <PropertyRow icon={<ListTodo size={16} color={colors.mutedForeground} />} label="Project" value={task.project?.title ?? "None"} onPress={() => setPicker("project")} />
              <PropertyRow
                icon={<Ban size={16} color={colors.mutedForeground} />}
                label="Blocked by"
                value={
                  task.blockedById
                    ? (tasks.find((item) => item.id === task.blockedById)?.name ?? task.blockedBy?.name ?? "None")
                    : "None"
                }
                onPress={() => setPicker("blocked")}
              />
              {tasks.some((item) => item.blockedById === task.id) ? (
                <Text style={styles.activity}>
                  Waiting on this: {tasks.filter((item) => item.blockedById === task.id).map((item) => item.name).join(", ")}
                </Text>
              ) : null}
              {stages.length > 0 ? (
                <PropertyRow
                  icon={<ListTodo size={16} color={colors.mutedForeground} />}
                  label="Stage"
                  value={stages.find((stage) => stage.id === task.stageId)?.name ?? "None"}
                  onPress={() => setPicker("stage")}
                />
              ) : null}
            </>
          ) : null}
          {isReminder && spaces.length > 0 ? (
          <PropertyRow
            icon={<FolderKanban size={16} color={colors.mutedForeground} />}
            label="Workspace"
            value={workspace?.name ?? "None"}
            onPress={() => setPicker("workspace")}
          />
          ) : null}
          {!isReminder && !isInbox ? (
          <PropertyRow
            icon={<Clock size={16} color={colors.mutedForeground} />}
            label="Duration"
            value={formatDuration(task.duration) ?? `${task.duration}m`}
            onPress={() => setPicker("duration")}
          />
          ) : null}
          <PropertyRow
            icon={<CalendarDays size={16} color={colors.mutedForeground} />}
            label="Start date"
            value={task.startDate ? formatShortDate(task.startDate) : "None"}
            onPress={() => setPicker("start")}
          />
          <PropertyRow
            icon={<CalendarDays size={16} color={overdue ? colors.destructive : colors.mutedForeground} />}
            label="Deadline"
            value={task.deadline ? formatShortDate(task.deadline) : "None"}
            tone={overdue ? colors.destructive : undefined}
            onPress={() => setPicker("due")}
          />
        </PropertyGroup>
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
        <View style={styles.sectionCard}>
        <TaskSectionHeader icon={<Sparkles size={18} color={colors.primary} />} title={isReminder ? "Reminder Schedule" : "Smart Schedule"} subtitle={isReminder ? "Choose when to get notified" : "Place and manage work blocks"} badge={task.scheduleLocked ? "Locked" : undefined} badgeTone="success" />
        {isReminder || task.recurrence ? (
          <>
            <Pressable onPress={() => setPicker("schedule")} style={styles.block}>
              <Text style={styles.blockText}>
                {task.scheduledOn || task.recurrence?.dtstart
                  ? isReminder && !task.recurrence
                    ? `Notify · ${formatRelativeDay(new Date(task.scheduledOn!), workingHoursZone)} · ${formatTime(task.scheduledOn!)}`
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
                  ? `Pings at ${formatRelativeDay(new Date(task.scheduledOn), workingHoursZone)} · ${formatTime(task.scheduledOn)}. Does not reserve a work block.`
                  : "Pick a date and time to ping. This does not reserve a work block."}
            </Text>
          </>
        ) : (
          <>
            {(task.blocks ?? []).map((block) => (
              <View key={block.id} style={styles.block}>
                <View style={styles.blockIcon}><Pin size={17} color={colors.primary} /></View>
                <View style={styles.blockCopy}>
                  <Text style={styles.blockDate}>{formatRelativeDay(new Date(block.start), workingHoursZone)}{block.locked || block.source === "manual" ? "  ·  PINNED" : ""}</Text>
                  <Text style={styles.blockText}>{formatTimeRange(block.start, block.end)}</Text>
                </View>
                {!isInactive ? <View style={{ flexDirection: "row", gap: 12 }}>
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
                </View> : null}
              </View>
            ))}
            {!isInactive ? <View style={styles.scheduleActions}>
              <Pressable onPress={() => setPicker("schedule")} style={styles.scheduleSecondary}>
                <Plus size={17} color={colors.primary} /><Text style={styles.scheduleActionText}>Add Time Slot</Text>
              </Pressable>
              {!isInbox ? <Pressable disabled={applySchedule.isPending} onPress={async () => {
                setScheduleError(null);
                try {
                  const plan = await applySchedule.mutateAsync({ taskIds: [task.id] });
                  const skipped = plan.skipped?.find((item) => item.taskId === task.id);
                  if (skipped) setScheduleError(skipped.message || "Could not auto-schedule this task.");
                  else if (!plan.proposals?.some((item) => item.taskId === task.id)) setScheduleError("The engine did not place this task.");
                } catch (err) { setScheduleError(err instanceof Error ? err.message : "Could not auto-schedule this task."); }
              }} style={styles.schedulePrimary}>
                <Sparkles size={16} color={colors.primaryForeground} /><Text style={styles.schedulePrimaryText}>{applySchedule.isPending ? "Scheduling…" : "Auto-Schedule"}</Text>
              </Pressable> : null}
            </View> : null}
            {!isInactive && (task.blocks ?? []).length > 0 ? (
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
            {!isInbox && !isInactive ? (
              <>
                {scheduleError ? (
                  <Text style={[styles.activity, { color: colors.destructive }]}>{scheduleError}</Text>
                ) : null}
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
                <Text style={styles.constraintLabel}>Minimum Chunk Duration <Text style={styles.constraintValue}>{task.minChunkMinutes ?? 15}m</Text></Text>
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
                      ? `Earliest · ${formatRelativeDay(new Date(task.earliestStartAt), workingHoursZone)} ${formatTime(task.earliestStartAt)}`
                      : "Earliest start · any time"}
                  </Text>
                </Pressable>
                <View style={styles.preferRow}>
                  <Pressable onPress={() => setPicker("preferStart")} style={styles.preferBtn}>
                    <Text style={styles.preferLabel}>Prefer from</Text>
                    <Text style={styles.preferValue}>{clockLabel(preferStart)}</Text>
                  </Pressable>
                  <Pressable onPress={() => setPicker("preferEnd")} style={styles.preferBtn}>
                    <Text style={styles.preferLabel}>Prefer to</Text>
                    <Text style={styles.preferValue}>{clockLabel(preferEnd)}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </>
        )}
        </View>
        {!isReminder ? (
          <>
            <View style={styles.editorCard}>
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
                showCustomFields={false}
              />
            </View>
            <View style={styles.editorCard}>
              <TaskMetaEditor
                workspace={workspace}
                workspaceId={task.workspaceId || metaWorkspaceId}
                labelIds={labelIds}
                onLabelIds={setLabelIds}
                values={customFieldValues}
                onValues={(next) => {
                  setCustomFieldValues(next);
                  scheduleSave({ customFieldValues: next });
                }}
                showLabels={false}
              />
            </View>
          </>
        ) : null}
        {!isReminder ? <>
        <Text style={styles.section}>{isInactive ? "Actions" : "Focus orchestration"}</Text>
        <View style={styles.actionGrid}>
          {!isInactive ? (
          <>
          <ActionTile
            icon={<Play size={17} color={colors.foreground} fill={task.focusStartedAt ? colors.foreground : "transparent"} />}
            label={task.focusStartedAt ? "Stop focus" : task.focusPausedAt ? "Resume focus" : "Start focus"}
            active={Boolean(task.focusStartedAt || task.focusPausedAt)}
            onPress={() =>
              task.focusStartedAt
                ? void stopFocus.mutateAsync(task.id)
                : void startFocus.mutateAsync(task.id)
            }
          />
          <ActionTile
            icon={<CalendarDays size={17} color={colors.foreground} />}
            label={onToday ? "Remove today" : "Add to Today"}
            active={onToday}
            onPress={() =>
              void setTodayFocus.mutateAsync({
                id: task.id,
                date: onToday ? null : localDateStamp(),
              })
            }
          />
          </>
          ) : null}
          <ActionTile
            icon={<Copy size={17} color={colors.foreground} />}
            label="Duplicate"
            onPress={() =>
              void duplicate.mutateAsync(task.id).then((copy) => router.push(`/(app)/tasks/${copy.id}`))
            }
          />
        </View>
        {(task.actualMinutes ?? 0) > 0 ? (
          <Text style={styles.activity}>{task.actualMinutes}m actually focused</Text>
        ) : null}
        <View style={styles.sectionCard}>
        <TaskSectionHeader icon={<ListChecks size={18} color={colors.success} />} title="Checklist" subtitle="Breakdown items" badge={`${combinedDone} of ${combinedTotal} done`} badgeTone="success" />
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(combinedProgress * 100)}%` }]} /></View>
        {checklist.map((item) => (
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
            style={styles.checkRow}
          >
            <View style={[styles.checkbox, item.completedAt && styles.checkboxDone]}>
              {item.completedAt ? <Check size={11} color="#07130d" strokeWidth={3} /> : null}
            </View>
            <Text style={[styles.checkText, item.completedAt && styles.checkTextDone]}>
              {item.title}
            </Text>
          </Pressable>
        ))}
        <Field
          value={childTitle}
          onChangeText={setChildTitle}
          placeholder="Add checklist item"
          autoCapitalize="sentences"
        />
        <View style={styles.addActions}>
          <Pressable
            onPress={() => {
              const title = childTitle.trim();
              if (!title) return;
              void addCheck.mutateAsync({ id: task.id, title }).then(() => setChildTitle(""));
            }}
            style={[styles.addBtn, !childTitle.trim() && styles.addBtnDisabled]}
          >
            <Text style={styles.addBtnText}>Add item</Text>
          </Pressable>
        </View>
        </View>
        </> : null}
        <View style={styles.sectionCard}>
        <TaskSectionHeader icon={<History size={18} color={colors.primary} />} title="Activity & Comments" subtitle="Latest system events" badge={`${(activity.data ?? []).length} events`} badgeTone="muted" />
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator={(activity.data ?? []).length > 4}
          style={(activity.data ?? []).length > 4 ? styles.activityLog : undefined}
        >
          {(activity.data ?? []).map((row) => (
            <View key={row.id} style={styles.activityRow}>
              <View style={styles.activityDot} />
              <Text style={styles.activity}><Text style={styles.activityActor}>{row.actorName}</Text> · {row.message}</Text>
            </View>
          ))}
        </ScrollView>
        <Field value={commentText} onChangeText={setCommentText} placeholder="Add a comment" autoCapitalize="sentences" />
        <PrimaryButton
          label="Comment"
          disabled={!commentText.trim()}
          onPress={() => {
            comment.mutate({ id: task.id, comment: commentText.trim() });
            setCommentText("");
          }}
        />
        </View>
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
            persist({ blockedById: "" });
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
        key={picker ?? "closed"}
        open={picker === "due" || picker === "start" || picker === "schedule" || picker === "earliest" || picker === "preferStart" || picker === "preferEnd"}
        value={
          picker === "due" && task.deadline
            ? new Date(task.deadline)
            : picker === "start" && task.startDate
              ? new Date(task.startDate)
              : picker === "earliest" && task.earliestStartAt
                ? new Date(task.earliestStartAt)
              : picker === "preferStart"
                ? parseClockDate(preferStart, 9)
              : picker === "preferEnd"
                ? parseClockDate(preferEnd, 12)
              : picker === "schedule" && (task.scheduledOn || task.recurrence?.dtstart)
                ? new Date(task.scheduledOn ?? task.recurrence!.dtstart)
                : new Date()
        }
        mode={
          picker === "due" || picker === "start"
            ? "date"
            : picker === "earliest"
              ? "datetime"
              : picker === "preferStart" || picker === "preferEnd"
                ? "time"
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
                : picker === "preferStart"
                  ? "Prefer from"
                : picker === "preferEnd"
                  ? "Prefer to"
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
          if (picker === "preferStart") {
            const start = next ? formatClockValue(next) : "";
            setPreferStart(start);
            persist({ preferredWindows: preferredWindowsPayload(start, preferEnd) });
          }
          if (picker === "preferEnd") {
            const end = next ? formatClockValue(next) : "";
            setPreferEnd(end);
            persist({ preferredWindows: preferredWindowsPayload(preferStart, end) });
          }
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
              addBlock.mutate({
                taskId: task.id,
                data: { start: next.toISOString(), durationMinutes: Math.max(15, task.duration || 30) },
              });
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

function ActionTile({ icon, label, active, onPress }: { icon: ReactNode; label: string; active?: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable onPress={onPress} style={[styles.actionTile, active && styles.actionTileActive]}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionTileText}>{label}</Text>
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  content: { padding: 16, paddingBottom: 40, gap: 16 },
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
  objectiveCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16, gap: 7 },
  eyebrow: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", letterSpacing: 0.9 },
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
  section: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.9, marginTop: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  progressText: { color: colors.success, fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700" },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden", width: "100%" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.success },
  sectionCard: { gap: 13, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 },
  editorCard: { borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 },
  actionGrid: { flexDirection: "row", gap: 8 },
  actionTile: { flex: 1, minWidth: 0, minHeight: 88, alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 5, paddingVertical: 9 },
  actionTileActive: { borderColor: colors.primary, backgroundColor: colors.accent },
  actionIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  actionTileText: { color: colors.foreground, fontSize: 11, lineHeight: 15, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  checkRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkboxDone: { borderColor: colors.success, backgroundColor: colors.success },
  checkText: { flex: 1, color: colors.foreground, fontSize: 12 },
  checkTextDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  addActions: { flexDirection: "row", gap: 8 },
  addBtn: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  addBtnSecondary: { backgroundColor: colors.secondary },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colors.primaryForeground, fontSize: 13, fontWeight: "700" },
  addBtnSecondaryText: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  preferRow: { flexDirection: "row", gap: 8 },
  preferBtn: { flex: 1, minWidth: 0, minHeight: 62, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center", gap: 2 },
  preferLabel: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  preferValue: { color: colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  block: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, padding: 12 },
  blockIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  blockCopy: { flex: 1, minWidth: 0, gap: 2 },
  blockDate: { color: colors.foreground, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  blockText: { color: colors.accentForeground, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  scheduleActions: { flexDirection: "row", gap: 8 },
  scheduleSecondary: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 16, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 6 },
  schedulePrimary: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 16, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 6 },
  scheduleActionText: { color: colors.foreground, fontSize: 11, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  schedulePrimaryText: { color: colors.primaryForeground, fontSize: 11, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  constraintLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  constraintValue: { color: colors.primary, fontWeight: "800" },
  activity: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  activityLog: { maxHeight: 156 },
  activityRow: { minHeight: 39, flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  activityActor: { color: colors.foreground, fontWeight: "700" },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
}));
