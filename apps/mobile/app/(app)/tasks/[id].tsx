import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, CircleDot, Copy, Flag, Pin, Play, Plus, Sparkles, Star, Trash2, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import { Dot, Field } from "../../../components/ui/primitives";
import { TimeField } from "../../../components/ui/DateTimeField";
import { ColorDot, GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../../../components/settings/SettingsList";
import { CustomFieldsGroup, LabelsRow, RepeatRow } from "../../../components/tasks/TaskMetaRows";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";
import EmptyState from "../../../components/ui/EmptyState";
import DescriptionCard from "../../../components/editor/DescriptionCard";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import InboxSuggestionsCard from "../../../components/tasks/InboxSuggestionsCard";
import TaskHintsCard from "../../../components/tasks/TaskHintsCard";
import RelatedList from "../../../components/search/RelatedList";
import { toCustomFieldDrafts, withCustomFieldDraft } from "../../../lib/customFields";
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
  useInboxSuggestionsQuery,
} from "../../../lib/hooks";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { dateOnly, formatDuration, formatRelativeDay, formatShortDate, formatShortDay, formatTime, formatTimeRange, localDateStamp, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../../lib/format";
import { normalizePriority } from "../../../lib/priority";
import { buildRecurrenceInput, rruleToDraft } from "../../../lib/recurrence";
import { richToPlain, toRichContent, isRichContentEmpty } from "../../../lib/richText";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { useDraftText } from "../../../lib/draftText";
import { useToastStore } from "../../../lib/toast";
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
  // The same answer the Suggestions card shows (cached): picking Reminder by
  // hand pings at the time read from the words ("Tuesday afternoon").
  const words = useInboxSuggestionsQuery(task?.kind === "inbox" ? task.id : undefined).data;
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
    ...(task.workspaceId ? [contextChip("workspace", "Workspace", task.workspaceId)] : []),
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

  const activityRows = (activity.data ?? []).map((row) => (
    <View key={row.id} style={styles.activityRow}>
      <View style={styles.activityDot} />
      <Text style={styles.activity}><Text style={styles.activityActor}>{row.actorName}</Text> · {row.message}</Text>
    </View>
  ));

  function persist(data: Parameters<typeof save.mutate>[0]["data"]) {
    const assigningMeta = Boolean(data.labelIds || data.customFieldValues);
    save.mutate({
      id: task!.id,
      data: {
        ...data,
        ...(!task!.workspaceId && !data.workspaceId && assigningMeta && metaWorkspaceId ? { workspaceId: metaWorkspaceId } : {}),
      },
    });
  }

  return (
    <Screen>
      <MobileHeader
        title={isReminder ? "Reminder" : isInbox ? "Inbox item" : "Task"}
        subtitle={[workspace?.name, selectedProject?.title].filter(Boolean).join(" › ") || undefined}
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
      <FocusGroupScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleCard}>
          <Field
            bare
            large
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
        <InboxSuggestionsCard
          key={task.id}
          task={task}
          spaces={spaces}
          projects={projects}
          fallbackWorkspaceId={metaWorkspaceId}
          onApply={(data) => {
            if (data.workspaceId) setMetaWorkspaceId(data.workspaceId);
            if (data.labelIds) setLabelIds(data.labelIds.map((label) => label.id));
            persist(data);
          }}
          onOpenTask={(taskId) => router.push(`/(app)/tasks/${taskId}`)}
        />
        {!isInbox && !isReminder ? (
          <TaskHintsCard
            key={`hints:${task.id}`}
            task={task}
            workspace={workspace}
            stages={stages}
            fieldValues={customFieldValues}
            onApply={persist}
            onField={(field, value) => {
              const next = withCustomFieldDraft(customFieldValues, field, value);
              setCustomFieldValues(next);
              persist({ customFieldValues: next });
            }}
            onPreferredWindow={(window) => {
              setPreferStart(window.start);
              setPreferEnd(window.end);
              persist({ preferredWindows: [window] });
            }}
          />
        ) : null}
        <DescriptionCard
            onSelectionChange={setAssistantSelection}
            content={isRichContentEmpty(noteRich) ? { type: "doc", content: [{ type: "paragraph" }] } : noteRich}
            syncKey={noteSync}
            placeholder="Add context, links, acceptance criteria, or notes…"
            writeContext={{ kind: "task", title: name }}
            onChange={({ content, plainText }) => {
              setNoteRich(content);
              setNote(plainText);
              scheduleSave({ description: plainText, descriptionRich: content });
            }}
        />

        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title="Type"
              trailing={
                <SegmentedControl
                  size="sm"
                  itemWidth={84}
                  accessibilityLabel="Type"
                  options={[
                    { label: "Work", value: "task" },
                    { label: "Reminder", value: "reminder" },
                  ]}
                  value={isInbox ? null : isReminder ? "reminder" : "task"}
                  onChange={(next) => {
                    if (next === "reminder") {
                      let readAt = "";
                      if (words?.available && words.date && (words.dateRole === "reminder" || words.time)) {
                        const [y, m, d] = words.date.split("-").map(Number);
                        const [h, min] = (words.time || "09:00").split(":").map(Number);
                        const at = new Date(y, m - 1, d, h, min);
                        if (at > new Date()) readAt = at.toISOString();
                      }
                      persist({
                        kind: "reminder",
                        duration: 0,
                        scheduledOn: readAt || task.scheduledOn || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
              }
            />
            {!isReminder || spaces.length > 0 ? (
              <ListRow title="Workspace" trailing={workspace?.name ?? (isReminder ? "None" : "Select")} onPress={() => setPicker("workspace")} />
            ) : null}
            {!isReminder ? (
              <ListRow title="Status" trailing={<RowValue text={task.status?.name ?? "None"} dot={task.status?.color ?? colors.mutedForeground} />} onPress={() => setPicker("status")} />
            ) : null}
            <PriorityRow level={task.priorityLevel} onPress={() => setPicker("priority")} />
            {!isReminder ? (
              <ListRow title="Project" trailing={<RowValue text={task.project?.title ?? "None"} dot={selectedProject?.color} />} onPress={() => setPicker("project")} />
            ) : null}
            {!isReminder && stages.length > 0 ? (
              <ListRow title="Stage" trailing={stages.find((stage) => stage.id === task.stageId)?.name ?? "None"} onPress={() => setPicker("stage")} />
            ) : null}
            {!isReminder ? (
              <ListRow
                title="Blocked by"
                trailing={
                  task.blockedById
                    ? (tasks.find((item) => item.id === task.blockedById)?.name ?? task.blockedBy?.name ?? "None")
                    : "None"
                }
                onPress={() => setPicker("blocked")}
              />
            ) : null}
            {!isReminder && !isInbox ? (
              <ListRow title="Duration" trailing={formatDuration(task.duration) ?? `${task.duration}m`} onPress={() => setPicker("duration")} />
            ) : null}
            {!isReminder ? (
              <LabelsRow
                workspace={workspace}
                workspaceId={task.workspaceId || metaWorkspaceId}
                labelIds={labelIds}
                onLabelIds={(next) => {
                  setLabelIds(next);
                  persist({ labelIds: next.map((labelId) => ({ id: labelId })) });
                }}
              />
            ) : null}
          </ListGroup>
          <GroupHint>
            {isInbox
              ? "Assign a workspace to put this on the board, or choose Reminder for a ping."
              : isReminder
                ? "Pings at a chosen time. Does not reserve a work block."
                : "Work is estimated minutes the scheduler can place."}
            {!isReminder && tasks.some((item) => item.blockedById === task.id)
              ? ` Waiting on this: ${tasks.filter((item) => item.blockedById === task.id).map((item) => item.name).join(", ")}.`
              : ""}
          </GroupHint>
        </View>

        <View style={styles.section}>
          <GroupLabel>Dates</GroupLabel>
          <ListGroup>
            <ListRow title="Start date" trailing={task.startDate ? formatShortDate(task.startDate) : "None"} onPress={() => setPicker("start")} />
            <ListRow
              title="Deadline"
              trailing={
                overdue && task.deadline ? (
                  <Text style={styles.overdue}>{formatShortDate(task.deadline)}</Text>
                ) : task.deadline ? formatShortDate(task.deadline) : "None"
              }
              onPress={() => setPicker("due")}
            />
            <RepeatRow
              value={task.recurrence ? rruleToDraft(task.recurrence.rrule, recAnchor) : null}
              anchor={recAnchor}
              subtitle={name || undefined}
              onChange={(draft) => {
                const recurrence = buildRecurrenceInput(draft, recAnchor);
                persist({
                  recurrence,
                  ...(recurrence && isReminder ? { scheduledOn: recurrence.dtstart } : {}),
                });
              }}
            />
            {task.recurrence ? (
              <ListRow
                title="Edits apply to"
                trailing={scope === "this" ? "This one" : scope === "future" ? "This and later" : "Whole series"}
                onPress={() => setPicker("scope")}
              />
            ) : null}
          </ListGroup>
        </View>

        {isReminder || task.recurrence ? (
          <View style={styles.section}>
            <GroupLabel>{isReminder ? "Reminder" : "Schedule"}</GroupLabel>
            <ListGroup>
              <ListRow
                title={isReminder && !task.recurrence ? "Notify at" : "Time"}
                trailing={
                  task.scheduledOn || task.recurrence?.dtstart
                    ? isReminder && !task.recurrence
                      ? `${formatRelativeDay(new Date(task.scheduledOn!), workingHoursZone)} ${formatTime(task.scheduledOn!)}`
                      : formatTime(task.scheduledOn ?? task.recurrence!.dtstart)
                    : "Pick a time"
                }
                onPress={() => setPicker("schedule")}
              />
            </ListGroup>
            <GroupHint>
              {task.recurrence
                ? isReminder
                  ? "Each repeat pings at this time and does not reserve a work block."
                  : "Each occurrence starts at this time; auto-schedule will not give the block to other tasks."
                : "Does not reserve a work block."}
            </GroupHint>
          </View>
        ) : (
          <View style={styles.section}>
            <GroupLabel aside={task.scheduleLocked ? "Pinned" : (task.blocks ?? []).length ? `${(task.blocks ?? []).length} reserved` : undefined}>Schedule</GroupLabel>
            {isInactive && !(task.blocks ?? []).length ? (
              <GroupHint>{task.blockedById ? "Not scheduled while it waits on its blocker." : "Not scheduled while it is done or blocked."}</GroupHint>
            ) : null}
            {!isInactive || (task.blocks ?? []).length ? (
            <ListGroup>
              {(task.blocks ?? []).map((block) => (
                <ListRow
                  key={block.id}
                  leading={<Pin size={16} color={block.locked || block.source === "manual" ? colors.primary : colors.mutedForeground} />}
                  title={formatTimeRange(block.start, block.end)}
                  meta={`${formatRelativeDay(new Date(block.start), workingHoursZone)}${block.locked || block.source === "manual" ? " · Pinned" : ""}`}
                  trailing={
                    !isInactive ? (
                      <View style={styles.rowActions}>
                        {block.source === "engine" && !block.locked ? (
                          <Pressable accessibilityRole="button" onPress={() => pinBlock.mutate({ blockId: block.id, locked: true })} hitSlop={8}>
                            <Text style={styles.rowAction}>Pin</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove this time"
                          onPress={() =>
                            setConfirm({
                              title: "Delete this time?",
                              message: "This reserved block will be removed.",
                              onConfirm: () => removeBlock.mutate(block.id),
                            })
                          }
                          hitSlop={8}
                        >
                          <X size={16} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ) : undefined
                  }
                />
              ))}
              {!isInactive ? <ListRow key="__add" tone="add" title="Add time" onPress={() => setPicker("schedule")} /> : null}
              {!isInactive && !isInbox ? (
                <ListRow
                  key="__auto"
                  tone="add"
                  leading={<Sparkles size={17} color={colors.primary} />}
                  title={applySchedule.isPending ? "Scheduling…" : "Auto-schedule"}
                  disabled={applySchedule.isPending}
                  onPress={async () => {
                    setScheduleError(null);
                    try {
                      const plan = await applySchedule.mutateAsync({ taskIds: [task.id] });
                      const skipped = plan.skipped?.find((item) => item.taskId === task.id);
                      if (skipped) setScheduleError(skipped.message || "Could not auto-schedule this task.");
                      else if (!plan.proposals?.some((item) => item.taskId === task.id)) setScheduleError("The engine did not place this task.");
                    } catch (err) { setScheduleError(err instanceof Error ? err.message : "Could not auto-schedule this task."); }
                  }}
                />
              ) : null}
              {!isInactive && (task.blocks ?? []).length > 0 ? (
                <ListRow
                  key="__clear"
                  tone="danger"
                  title="Clear all time"
                  onPress={() =>
                    setConfirm({
                      title: "Clear all reserved time?",
                      message: "Every work block on this task will be removed.",
                      confirmLabel: "Clear",
                      onConfirm: () => clearBlocks.mutate(task.id),
                    })
                  }
                />
              ) : null}
            </ListGroup>
            ) : null}
            {scheduleError ? <Text style={styles.error}>{scheduleError}</Text> : null}
            {!isInbox && !isInactive ? (
              <>
                <GroupLabel>Auto-schedule</GroupLabel>
                <ListGroup>
                  <SwitchRow
                    title="Pin task"
                    meta="Auto-schedule will not move it"
                    value={Boolean(task.scheduleLocked)}
                    onChange={(locked) => pinTask.mutate({ taskId: task.id, locked })}
                  />
                  <SwitchRow title="One sitting" meta="Place it as one block" value={Boolean(task.contiguous)} onChange={(contiguous) => persist({ contiguous })} />
                  <ListRow
                    title="Minimum chunk"
                    trailing={
                      <SegmentedControl
                        size="sm"
                        accessibilityLabel="Minimum chunk"
                        options={[15, 30, 45, 60].map((minutes) => ({ label: `${minutes}m`, value: String(minutes) }))}
                        value={String(task.minChunkMinutes ?? 15)}
                        onChange={(next) => persist({ minChunkMinutes: Number(next) })}
                      />
                    }
                  />
                  <ListRow
                    title="Preferred chunk"
                    trailing={
                      <SegmentedControl
                        size="sm"
                        accessibilityLabel="Preferred chunk"
                        options={[{ label: "Any", value: "any" }, ...[30, 60, 90].map((minutes) => ({ label: `${minutes}m`, value: String(minutes) }))]}
                        value={task.preferredChunkMinutes == null ? "any" : String(task.preferredChunkMinutes)}
                        onChange={(next) => persist({ preferredChunkMinutes: next === "any" ? null : Number(next) })}
                      />
                    }
                  />
                  <ListRow
                    title="Earliest start"
                    trailing={
                      task.earliestStartAt
                        ? `${formatRelativeDay(new Date(task.earliestStartAt), workingHoursZone)} ${formatTime(task.earliestStartAt)}`
                        : "Any time"
                    }
                    onPress={() => setPicker("earliest")}
                  />
                  <ListRow
                    title="Work hours"
                    trailing={
                      <View style={styles.pills}>
                        <TimeField
                          compact
                          clearable
                          label="Work from"
                          placeholder="Any"
                          value={preferStart}
                          onChange={(start) => {
                            setPreferStart(start);
                            persist({ preferredWindows: preferredWindowsPayload(start, preferEnd) });
                          }}
                        />
                        <Text style={styles.pillDash}>–</Text>
                        <TimeField
                          compact
                          clearable
                          label="Work until"
                          placeholder="Any"
                          value={preferEnd}
                          onChange={(end) => {
                            setPreferEnd(end);
                            persist({ preferredWindows: preferredWindowsPayload(preferStart, end) });
                          }}
                        />
                      </View>
                    }
                  />
                </ListGroup>
              </>
            ) : null}
          </View>
        )}

        {!isReminder ? (
          <CustomFieldsGroup
            workspace={workspace}
            workspaceId={task.workspaceId || metaWorkspaceId}
            values={customFieldValues}
            onValues={(next) => {
              setCustomFieldValues(next);
              scheduleSave({ customFieldValues: next });
            }}
          />
        ) : null}

        {!isReminder ? (
          <View style={styles.section}>
            <GroupLabel aside={(task.actualMinutes ?? 0) > 0 ? `${task.actualMinutes}m focused` : undefined}>Actions</GroupLabel>
            <ListGroup>
              {!isInactive ? (
                <ListRow
                  key="focus"
                  leading={<Play size={16} color={colors.foreground} fill={task.focusStartedAt ? colors.foreground : "transparent"} />}
                  title={task.focusStartedAt ? "Stop focus" : task.focusPausedAt ? "Resume focus" : "Start focus"}
                  chevron={false}
                  onPress={() =>
                    task.focusStartedAt
                      ? void stopFocus.mutateAsync(task.id)
                      : void startFocus.mutateAsync(task.id)
                  }
                />
              ) : null}
              {!isInactive ? (
                <ListRow
                  key="today"
                  leading={<Star size={16} color={onToday ? colors.warning : colors.foreground} fill={onToday ? colors.warning : "transparent"} />}
                  title={onToday ? "On Today" : "Add to Today"}
                  trailing={onToday ? "Remove" : undefined}
                  chevron={false}
                  onPress={() =>
                    void setTodayFocus.mutateAsync({
                      id: task.id,
                      date: onToday ? null : localDateStamp(),
                    })
                  }
                />
              ) : null}
              <ListRow
                key="duplicate"
                leading={<Copy size={16} color={colors.foreground} />}
                title="Duplicate"
                chevron={false}
                onPress={() =>
                  void duplicate.mutateAsync(task.id).then((copy) => router.push(`/(app)/tasks/${copy.id}`))
                }
              />
            </ListGroup>
          </View>
        ) : null}

        {!isReminder ? (
          <View style={styles.section}>
            <GroupLabel aside={combinedTotal ? `${combinedDone} of ${combinedTotal} done` : undefined}>Checklist</GroupLabel>
            <ListGroup>
              {checklist.map((item) => (
                <AnimatedPressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: Boolean(item.completedAt) }}
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
                    {item.completedAt ? <Check size={11} color={colors.primaryForeground} strokeWidth={3} /> : null}
                  </View>
                  <Text style={[styles.checkText, item.completedAt && styles.checkTextDone]}>{item.title}</Text>
                </AnimatedPressable>
              ))}
              <View key="__add" style={styles.checkRow}>
                <Plus size={18} color={colors.primary} />
                <View style={styles.inlineField}>
                  <Field value={childTitle} onChangeText={setChildTitle} bare placeholder="Add checklist item" autoCapitalize="sentences" />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!childTitle.trim()}
                  hitSlop={8}
                  onPress={() => {
                    const title = childTitle.trim();
                    if (!title) return;
                    void addCheck.mutateAsync({ id: task.id, title }).then(() => setChildTitle(""));
                  }}
                >
                  <Text style={[styles.inlineAction, !childTitle.trim() && styles.inlineActionOff]}>Add</Text>
                </Pressable>
              </View>
            </ListGroup>
            {combinedTotal ? <GroupHint>Tap to tick, hold to remove.</GroupHint> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <GroupLabel aside={(activity.data ?? []).length ? String((activity.data ?? []).length) : undefined}>Activity</GroupLabel>
          <ListGroup>
            {(activity.data ?? []).length > 0 ? (
              (activity.data ?? []).length > 4 ? (
                <ScrollView
                  key="log"
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={styles.activityLog}
                  contentContainerStyle={styles.activityPad}
                >
                  {activityRows}
                </ScrollView>
              ) : (
                // A short log needs no scroller; on Android one sized to its
                // content cut off the last wrapped line.
                <View key="log" style={styles.activityPad}>
                  {activityRows}
                </View>
              )
            ) : null}
            <FocusGroup key="__comment">
              <View style={styles.checkRow}>
                <View style={styles.inlineField}>
                  <Field value={commentText} onChangeText={setCommentText} bare placeholder="Add a comment" autoCapitalize="sentences" />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!commentText.trim()}
                  hitSlop={8}
                  onPress={() => {
                    comment.mutate({ id: task.id, comment: commentText.trim() });
                    setCommentText("");
                  }}
                >
                  <Text style={[styles.inlineAction, !commentText.trim() && styles.inlineActionOff]}>Send</Text>
                </Pressable>
              </View>
            </FocusGroup>
          </ListGroup>
        </View>
        {task.kind !== "inbox" && (
          <RelatedList
            kind="task"
            id={task.id}
            style={styles.relatedCard}
            heading={<Text style={styles.relatedHeading}>Related</Text>}
          />
        )}
        <ListGroup>
          <ListRow
            tone="danger"
            leading={<Trash2 size={16} color={colors.destructive} />}
            title="Delete task"
            onPress={() =>
              setConfirm({
                title: "Delete task",
                message: "This cannot be undone.",
                onConfirm: () => remove.mutate(task.id, { onSuccess: () => router.replace("/(app)/(tabs)/tasks") }),
              })
            }
          />
        </ListGroup>
      </FocusGroupScrollView>

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
          // The server refuses a start after the deadline; say so up front
          // instead of letting the save fail and the value snap back.
          if (picker === "due") {
            const deadline = next ? toDateInputValue(next) : null;
            const start = dateOnly(task.startDate);
            if (deadline && start && deadline < start) {
              useToastStore.getState().show(`Deadline can’t be before the start date (${formatShortDay(start)}).`);
              return;
            }
            persist({ deadline });
          }
          if (picker === "start") {
            if (!next) {
              persist({ startDate: null });
              return;
            }
            const start = toDateInputValue(next);
            const deadline = dateOnly(task.deadline);
            if (deadline && start > deadline) {
              useToastStore.getState().show(`Start date can’t be after the deadline (${formatShortDay(deadline)}).`);
              return;
            }
            persist({ startDate: start });
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

/** A row's value with an optional colour dot (a project, a status). */
function RowValue({ text, dot }: { text: string; dot?: string | null }) {
  return (
    <View style={styles.value}>
      {dot ? <ColorDot color={dot} size={8} /> : null}
      <Text numberOfLines={1} style={styles.valueText}>{text}</Text>
    </View>
  );
}

function PriorityRow({ level, onPress }: { level?: string | null; onPress: () => void }) {
  const meta = level ? PRIORITY_META[level] : undefined;
  // Only a raised priority earns a colour.
  const tint = level === "High" || level === "Urgent" ? meta?.color : undefined;
  return (
    <ListRow
      title="Priority"
      trailing={
        <View style={styles.value}>
          {tint ? <Flag size={14} color={tint} /> : null}
          <Text numberOfLines={1} style={[styles.valueText, tint ? { color: tint } : null]}>{meta?.label ?? level ?? "None"}</Text>
        </View>
      }
      onPress={onPress}
      accessibilityLabel={`Priority, ${meta?.label ?? level ?? "None"}`}
    />
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
  titleCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12 },
  section: { gap: 6 },
  value: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  valueText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  overdue: { color: colors.destructive, fontSize: 13, fontWeight: "600" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowAction: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 4 },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  pillDash: { color: colors.mutedForeground, fontSize: 13 },
  checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkboxDone: { borderColor: colors.success, backgroundColor: colors.success },
  checkText: { flex: 1, color: colors.foreground, fontSize: 15 },
  checkTextDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  inlineField: { flex: 1, minWidth: 0 },
  inlineAction: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  inlineActionOff: { color: colors.mutedForeground, opacity: 0.6 },
  activity: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  activityLog: { maxHeight: 180, flexGrow: 0 },
  activityPad: { paddingHorizontal: 14, paddingVertical: 8 },
  activityRow: { minHeight: 32, flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  activityActor: { color: colors.foreground, fontWeight: "600" },
  relatedCard: { gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  relatedHeading: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
}));
