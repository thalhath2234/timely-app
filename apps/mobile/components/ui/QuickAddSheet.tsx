import { startTransition, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useRouter } from "expo-router";
import InboxCapture from "../inbox/InboxCapture";
import { Bell, CalendarClock, Check, ChevronDown, ChevronUp, FileText, Flag, Inbox, ListTodo, Sheet as SheetIcon, Sparkles } from "lucide-react-native";
import BottomSheet, { SheetOption } from "./BottomSheet";
import DateTimeSheet from "./DateTimeSheet";
import { Button, Dot, Field } from "./primitives";
import { TimeField } from "./DateTimeField";
import { ColorDot, GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../settings/SettingsList";
import { CustomFieldsGroup, LabelsRow, RepeatRow } from "../tasks/TaskMetaRows";
import RichTextEditor from "../editor/RichTextEditor";
import AnimatedPressable from "./AnimatedPressable";
import { emptyCustomFieldDrafts, filledCustomFieldValues } from "../../lib/customFields";
import { isRichContentEmpty, toRichContent } from "../../lib/richText";
import type { DocContent } from "../../lib/types";
import { useCreateEvent, useCreateTask, useAddBlock, useEstimateQuery, useProjectsQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildRecurrenceInput, type RecurrenceDraft } from "../../lib/recurrence";
import { TemplateField, useCreateFromTemplate, useNewFileTemplates } from "../files/NewFileTemplates";
import { fileHref } from "../../lib/fileRoutes";
import { formatDuration, formatShortDate, formatTime, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../lib/format";
import type { CustomFieldValueInput } from "../../lib/types";
import type { QuickAddPreset } from "../../lib/quickAddIntent";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { ENTITY_COLORS, colorName } from "../../lib/entityColor";
import { expandEntering, listLayout, pageDuration } from "../../lib/motion";
import { useToastStore } from "../../lib/toast";

function runWhenIdle(callback: () => void, timeout: number) {
  const timer = setTimeout(callback, timeout);
  return () => clearTimeout(timer);
}

type Kind = "inbox" | "task" | "reminder" | "event" | "doc" | "sheet";
const KINDS: { value: Kind; label: string; Icon: typeof ListTodo }[] = [
  { value: "inbox", label: "Inbox", Icon: Inbox },
  { value: "task", label: "Task", Icon: ListTodo },
  { value: "reminder", label: "Reminder", Icon: Bell },
  { value: "event", label: "Event", Icon: CalendarClock },
  { value: "doc", label: "Doc", Icon: FileText },
  { value: "sheet", label: "Sheet", Icon: SheetIcon },
];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const EMPTY_DESCRIPTION: DocContent = { type: "doc", content: [{ type: "paragraph" }] };
const DURATION_PRESETS = [0, 15, 30, 45, 60, 90, 120];

function nextRoundHour() {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function formatDateValue(value: Date | null, withTime = false) {
  if (!value) return "None";
  const date = formatShortDate(value.toISOString());
  return withTime ? `${date} ${formatTime(value.toISOString())}` : date;
}

function applyClock(day: Date, clock: Date) {
  const next = new Date(day);
  next.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return next;
}

function clockValue(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function makeReminderTime(current: Date | null) {
  if (current) return current;
  return nextRoundHour();
}

export default function QuickAddSheet({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset?: QuickAddPreset | null;
}) {
  const router = useRouter();
  const workspaces = useWorkspacesQuery();
  const projects = useProjectsQuery();
  const createTask = useCreateTask();
  const createEvent = useCreateEvent();
  const fromTemplate = useCreateFromTemplate();
  const addBlock = useAddBlock();
  const reduceMotion = useReducedMotion();

  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionRich, setDescriptionRich] = useState<DocContent>(EMPTY_DESCRIPTION);
  const [noteSync, setNoteSync] = useState(0);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [stageId, setStageId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("Medium");
  const [duration, setDuration] = useState(30);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [scheduledOn, setScheduledOn] = useState<Date | null>(null);
  const [earliestStartAt, setEarliestStartAt] = useState<Date | null>(null);
  const [preferFrom, setPreferFrom] = useState<Date | null>(null);
  const [preferTo, setPreferTo] = useState<Date | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueInput[]>([]);
  const [taskRecurrence, setTaskRecurrence] = useState<RecurrenceDraft | null>(null);
  const [eventStart, setEventStart] = useState(nextRoundHour);
  const [eventDuration, setEventDuration] = useState(60);
  const [allDay, setAllDay] = useState(false);
  const [eventRecurrence, setEventRecurrence] = useState<RecurrenceDraft | null>(null);
  const [eventWorkspaceId, setEventWorkspaceId] = useState("");
  const [eventColor, setEventColor] = useState("");
  const [eventProjectId, setEventProjectId] = useState("");
  // A new doc or sheet starts blank ("") or from this template.
  const [templateId, setTemplateId] = useState("");
  const [picking, setPicking] = useState<
    | "due"
    | "startDate"
    | "schedule"
    | "earliest"
    | "preferFrom"
    | "preferTo"
    | "eventStart"
    | "workspace"
    | "project"
    | "status"
    | "stage"
    | "priority"
    | "duration"
    | "eventDuration"
    | "eventWorkspace"
    | "eventProject"
    | "eventColor"
    | null
  >(null);
  const estimate = useEstimateQuery(title, picking === "duration");
  const suggested = estimate.data?.minutes;
  const [phase, setPhase] = useState<"menu" | "form">("menu");
  const [selectedKind, setSelectedKind] = useState<Kind | null>(null);
  // "opening": the rich editor is loading while the plain field it replaces
  // keeps the keyboard; "open" once the editor has taken focus.
  const [editor, setEditor] = useState<"closed" | "opening" | "open">("closed");
  const editorOpen = editor !== "closed";
  const [editorFocus, setEditorFocus] = useState(0);
  const [detailsReady, setDetailsReady] = useState(false);
  // Repeat, the Auto-schedule window, labels and custom fields sit behind
  // one chip so a new task starts as a title and a row of chips.
  const [more, setMore] = useState(false);

  const list = workspaces.data ?? [];
  const projectList = projects.data ?? [];
  const activeWorkspaceId = workspaceId || list[0]?.id || "";
  const selectedWorkspace = list.find((workspace) => workspace.id === activeWorkspaceId);
  const scopedProjects = projectList.filter((project) => project.workspaceId === activeWorkspaceId);
  const selectedProject = projectList.find((project) => project.id === projectId);
  const eventScopedProjects = projectList.filter(
    (project) => !eventWorkspaceId || project.workspaceId === eventWorkspaceId,
  );
  const stages = [...(selectedProject?.stages ?? [])].sort((a, b) => a.order - b.order);
  const pending = createTask.isPending || createEvent.isPending || fromTemplate.pending;
  const fileTemplates = useNewFileTemplates(kind === "sheet" ? "sheet" : "doc", title, open && (kind === "doc" || kind === "sheet"));

  const isReminder = kind === "reminder";
  const moreCount =
    (startDate ? 1 : 0) +
    (earliestStartAt ? 1 : 0) +
    (preferFrom || preferTo ? 1 : 0) +
    (labelIds.length > 0 ? 1 : 0) +
    filledCustomFieldValues(customFieldValues).length;
  const taskTimeOnly = Boolean(taskRecurrence);
  const taskAnchor = useMemo(() => scheduledOn ?? nextRoundHour(), [scheduledOn]);
  const eventMinutes = Math.max(15, eventDuration || 60);

  function turnIntoReminder() {
    setKind("reminder");
    setDuration(0);
    setScheduledOn((current) => makeReminderTime(current));
  }

  function addDuration() {
    setKind("task");
    setDuration(30);
  }

  useEffect(() => {
    if (!open || list.length === 0) return;
    if (!workspaceId || !list.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(list[0].id);
    }
  }, [open, list, workspaceId]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    const defaultStatus = selectedWorkspace.status?.find((status) => status.isDefault) ?? selectedWorkspace.status?.[0];
    setStatusId(defaultStatus?.id ?? "");
    setProjectId("");
    setStageId("");
    setLabelIds([]);
    setCustomFieldValues(emptyCustomFieldDrafts(selectedWorkspace.customFields));
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (open) setEventStart(nextRoundHour());
  }, [open]);

  useEffect(() => {
    if (!open || !preset) return;
    if (preset.kind) setKind(preset.kind);
    if (preset.title) setTitle(preset.title);
    if (preset.workspaceId) setWorkspaceId(preset.workspaceId);
    if (preset.start) {
      if (preset.kind === "event") setEventStart(preset.start);
      else if (preset.kind === "reminder") {
        setDuration(0);
        setScheduledOn(preset.start);
      } else {
        setScheduledOn(preset.start);
      }
    }
  }, [open, preset]);

  useEffect(() => {
    if (!open) return;
    setPhase(preset?.kind ? "form" : "menu");
    setSelectedKind(null);
    setEditor("closed");
  }, [open, preset?.kind]);

  useEffect(() => {
    if (!open) return;
    if (phase !== "form") {
      setDetailsReady(false);
      return;
    }
    return runWhenIdle(() => setDetailsReady(true), pageDuration);
  }, [open, phase]);

  function closeSheet() {
    onClose();
  }

  function finishClose() {
    setMore(false);
    setPhase("menu");
    setSelectedKind(null);
    setEditor("closed");
    setDetailsReady(false);
  }

  function pickKind(value: Kind) {
    if (value === "reminder") turnIntoReminder();
    else if (value === "task" && isReminder) addDuration();
    else setKind(value);
    setTemplateId("");
    setSelectedKind(value);
    startTransition(() => setPhase("form"));
  }

  useEffect(() => {
    if (!open || !preset?.projectId) return;
    setProjectId(preset.projectId);
  }, [open, preset?.projectId, selectedWorkspace?.id]);

  function reset() {
    setTitle("");
    setDescription("");
    setDescriptionRich(EMPTY_DESCRIPTION);
    setNoteSync((value) => value + 1);
    setProjectId("");
    setStageId("");
    setPriority("Medium");
    setDuration(30);
    setStartDate(null);
    setDeadline(null);
    setScheduledOn(null);
    setEarliestStartAt(null);
    setPreferFrom(null);
    setPreferTo(null);
    setLabelIds([]);
    setTaskRecurrence(null);
    setEventRecurrence(null);
    setEventDuration(60);
    setAllDay(false);
    setEventStart(nextRoundHour());
    setEventWorkspaceId("");
    setEventColor("");
    setEventProjectId("");
    setTemplateId("");
    setKind("task");
    if (selectedWorkspace) {
      const defaultStatus = selectedWorkspace.status?.find((status) => status.isDefault) ?? selectedWorkspace.status?.[0];
      setStatusId(defaultStatus?.id ?? "");
      setCustomFieldValues(emptyCustomFieldDrafts(selectedWorkspace.customFields));
    }
  }

  async function submit() {
    const name = title.trim();
    if (!name || pending) return;
    if (kind === "task" || kind === "reminder") {
      if (!isReminder && !activeWorkspaceId) return;
      if (!isReminder && (Boolean(preferFrom) !== Boolean(preferTo) ||
        (preferFrom && preferTo && clockValue(preferTo) <= clockValue(preferFrom)))) {
        Alert.alert("Check preferred times", "Set both times, with Prefer to later than Prefer from.");
        return;
      }
      const filledFields = filledCustomFieldValues(customFieldValues);
      const wantsMeta = labelIds.length > 0 || filledFields.length > 0;
      if (wantsMeta && !activeWorkspaceId) return;
      const recurrence = buildRecurrenceInput(taskRecurrence, taskAnchor);
      const created = await createTask.mutateAsync({
        name,
        description: description.trim() || "",
        descriptionRich: isRichContentEmpty(descriptionRich) ? undefined : descriptionRich,
        kind: isReminder ? "reminder" : "task",
        workspaceId: isReminder && !wantsMeta ? undefined : activeWorkspaceId,
        projectId: isReminder ? undefined : projectId || undefined,
        stageId: isReminder ? undefined : stageId || undefined,
        statusId: isReminder ? undefined : statusId || undefined,
        priorityLevel: priority,
        startDate: startDate ? toDateInputValue(startDate) : undefined,
        deadline: deadline ? toDateInputValue(deadline) : undefined,
        scheduledOn: !recurrence
          ? (scheduledOn ?? (isReminder ? nextRoundHour() : null))?.toISOString()
          : undefined,
        earliestStartAt: !isReminder ? earliestStartAt?.toISOString() : undefined,
        preferredWindows: !isReminder && preferFrom && preferTo
          ? [{ start: clockValue(preferFrom), end: clockValue(preferTo) }]
          : undefined,
        duration: isReminder ? 0 : duration,
        labelIds: labelIds.length ? labelIds.map((id) => ({ id })) : undefined,
        customFieldValues: filledFields.length ? filledFields : undefined,
        recurrence: recurrence ?? undefined,
      });
      if (!isReminder && !recurrence && scheduledOn && created?.id) {
        await addBlock.mutateAsync({
          taskId: created.id,
          data: { start: scheduledOn.toISOString(), durationMinutes: duration || 30 },
        });
      }
      finish(isReminder ? "/(app)/(tabs)/calendar" : "/(app)/(tabs)/tasks");
      return;
    }
    if (kind === "event") {
      await createEvent.mutateAsync({
        title: name,
        description: description.trim() || undefined,
        start: eventStart.toISOString(),
        end: new Date(eventStart.getTime() + eventMinutes * 60_000).toISOString(),
        allDay,
        color: eventColor || undefined,
        workspaceId: eventWorkspaceId || undefined,
        projectId: eventProjectId || undefined,
        recurrence: buildRecurrenceInput(eventRecurrence, eventStart) ?? undefined,
      });
      finish("/(app)/(tabs)/calendar");
      return;
    }
    const fileId = await fromTemplate.create(fileTemplates, { title: name, templateId: templateId || undefined, workspaceId: activeWorkspaceId });
    reset();
    onClose();
    router.push(fileHref(fileId));
  }

  // The Inbox form is the Inbox screen's own capture box: it saves itself,
  // so the sheet only closes and says where the thought went.
  function captured() {
    reset();
    onClose();
    useToastStore.getState().show("Captured to Inbox", {
      label: "Open",
      onAction: () => router.push("/(app)/inbox"),
    });
  }

  function finish(href: string) {
    reset();
    onClose();
    router.push(href as never);
  }

  const pickerValue =
    picking === "due"
      ? deadline
      : picking === "startDate"
        ? startDate
        : picking === "schedule"
          ? scheduledOn
          : picking === "earliest"
            ? earliestStartAt
            : picking === "preferFrom"
              ? preferFrom
              : picking === "preferTo"
                ? preferTo
          : picking === "eventStart"
            ? eventStart
            : null;

  const kindMeta = KINDS.find((item) => item.value === kind) ?? KINDS[1];
  const workspaceName = selectedWorkspace?.name ?? "Workspace";
  const statusMeta = selectedWorkspace?.status?.find((status) => status.id === statusId);
  const stageName = stages.find((stage) => stage.id === stageId)?.name;
  const eventWorkspace = list.find((workspace) => workspace.id === eventWorkspaceId);
  const eventProject = projectList.find((project) => project.id === eventProjectId);
  const needsWorkspace = (kind === "task" && !isReminder) || kind === "doc" || kind === "sheet";
  const canSubmit = Boolean(title.trim()) && !pending && !(needsWorkspace && !activeWorkspaceId);
  const summary = quickAddSummary({
    kind,
    where: selectedProject?.title ?? workspaceName,
    duration,
    deadline,
    scheduledOn,
    timeOnly: taskTimeOnly,
    recurring: Boolean(taskRecurrence),
    eventStart,
    eventMinutes,
    allDay,
    template: (kind === "doc" || kind === "sheet") ? fileTemplates.choices.find((template) => template.id === templateId)?.name : undefined,
  });

  const header =
    phase === "form" ? (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${kindMeta.label}, change type`}
        onPress={() => {
          setSelectedKind(null);
          setPhase("menu");
          setEditor("closed");
          setMore(false);
        }}
        hitSlop={6}
        style={styles.kindSwitch}
      >
        <kindMeta.Icon size={16} color={colors.accentForeground} />
        <Text style={styles.kindSwitchText}>{kindMeta.label}</Text>
        <ChevronDown size={14} color={colors.accentForeground} />
      </AnimatedPressable>
    ) : undefined;

  return (
    <BottomSheet
      open={open}
      onClose={closeSheet}
      onClosed={finishClose}
      // Hidden behind the kind chip in the form; a picker shows it under its own title.
      title={phase === "form" ? (kind === "inbox" ? "Capture to Inbox" : title.trim() || `New ${kindMeta.label.toLowerCase()}`) : "New"}
      leading={header}
      footer={
        phase === "form" && kind !== "inbox" ? (
          <View style={styles.actionBar}>
            <View style={styles.summary}>
              <Text style={styles.summaryMain} numberOfLines={1}>{summary.main}</Text>
              {summary.detail ? <Text style={styles.summaryDetail} numberOfLines={1}>{summary.detail}</Text> : null}
            </View>
            <Button
              testID="quick-add-submit"
              label={pending ? "Saving…" : "Create"}
              icon={pending ? undefined : <Check size={16} color={colors.primaryForeground} strokeWidth={2.5} />}
              loading={pending}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />
          </View>
        ) : undefined
      }
    >
      <Animated.View layout={listLayout(Boolean(reduceMotion))}>
      {phase === "menu" ? (
        <Animated.View key="menu" entering={expandEntering(Boolean(reduceMotion))} style={styles.kinds}>
          {KINDS.map((item) => (
            <AnimatedPressable
              key={item.value}
              onPress={() => pickKind(item.value)}
              android_ripple={{ color: `${colors.primary}22` }}
              style={[styles.kind, selectedKind === item.value && styles.kindSelected]}
            >
              <View style={[styles.kindIcon, selectedKind === item.value && styles.kindIconSelected]}>
                <item.Icon size={20} color={selectedKind === item.value ? colors.primary : colors.mutedForeground} />
              </View>
              <Text style={[styles.kindText, selectedKind === item.value && styles.kindTextSelected]}>{item.label}</Text>
            </AnimatedPressable>
          ))}
        </Animated.View>
      ) : (
      <Animated.View key={`form-${kind}`} entering={expandEntering(Boolean(reduceMotion))} style={styles.fields}>
        {kind === "inbox" ? (
          <InboxCapture autoFocus initialTitle={title} onCaptured={captured} />
        ) : (
        <View style={styles.titleBlock}>
          <Field
            bare
            large
            multiline
            autoGrow
            autoFocus={!preset?.title}
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
            placeholder={
              kind === "task"
                ? "What needs to be done?"
                : kind === "reminder"
                  ? "Remind me to…"
                  : kind === "event"
                    ? "Event name"
                    : `Untitled ${kind}`
            }
          />

          {kind === "task" || kind === "reminder" ? (
            <View>
              {editorOpen ? (
                <RichTextEditor
                  compact
                  openMentions={false}
                  content={descriptionRich}
                  syncKey={noteSync}
                  focusRequest={editorFocus}
                  placeholder="Add notes, type / for blocks"
                  writeContext={{ kind: "task", title }}
                  onFocusChange={(focused) => {
                    if (focused) setEditor("open");
                  }}
                  onChange={({ content, plainText }) => {
                    setDescriptionRich(content);
                    setDescription(plainText);
                  }}
                />
              ) : null}
              {editor !== "open" ? (
                // This field stays mounted (on top of the loading editor) until
                // the editor has focus. Unmounting it while focused sends the
                // focus to the title, so the first tap would land there.
                <View style={editorOpen ? styles.descriptionBridge : undefined}>
                  <Field
                    bare
                    multiline
                    value={description}
                    onChangeText={(text) => {
                      setDescription(text);
                      setDescriptionRich(text.trim() ? toRichContent(null, text) : EMPTY_DESCRIPTION);
                    }}
                    onFocus={() => {
                      setEditor((current) => (current === "closed" ? "opening" : current));
                      setEditorFocus((count) => count + 1);
                    }}
                    onBlur={() => setEditorFocus(0)}
                    autoCapitalize="sentences"
                    placeholder="Add notes, type / for blocks"
                  />
                </View>
              ) : null}
            </View>
          ) : kind === "event" ? (
            <Field
              bare
              value={description}
              onChangeText={setDescription}
              multiline
              autoCapitalize="sentences"
              placeholder="Notes, place, links"
            />
          ) : null}
        </View>
        )}

        {kind === "task" ? (
          <View style={styles.groups}>
            <ListGroup>
              <ListRow title="Workspace" trailing={workspaceName} onPress={() => setPicking("workspace")} />
              {scopedProjects.length > 0 ? (
                <ListRow title="Project" trailing={<RowValue text={selectedProject?.title ?? "None"} dot={selectedProject?.color} />} onPress={() => setPicking("project")} />
              ) : null}
              {stages.length > 0 ? <ListRow title="Stage" trailing={stageName ?? "None"} onPress={() => setPicking("stage")} /> : null}
              {(selectedWorkspace?.status ?? []).length > 0 ? (
                <ListRow title="Status" trailing={<RowValue text={statusMeta?.name ?? "None"} dot={statusMeta?.color ?? colors.mutedForeground} />} onPress={() => setPicking("status")} />
              ) : null}
              <PriorityRow priority={priority} onPress={() => setPicking("priority")} />
              <ListRow title="Duration" trailing={formatDuration(duration) ?? `${duration}m`} onPress={() => setPicking("duration")} />
            </ListGroup>
            <View style={styles.section}>
              <GroupLabel>When</GroupLabel>
              <ListGroup>
                <ListRow title="Deadline" trailing={deadline ? formatShortDate(deadline.toISOString()) : "None"} onPress={() => setPicking("due")} />
                <ListRow
                  title={taskTimeOnly ? "Time" : "Schedule"}
                  trailing={scheduledOn ? (taskTimeOnly ? formatTime(scheduledOn.toISOString()) : formatDateValue(scheduledOn, true)) : "None"}
                  onPress={() => setPicking("schedule")}
                />
                <RepeatRow
                  value={taskRecurrence}
                  anchor={taskAnchor}
                  subtitle={title.trim() || undefined}
                  onChange={(next) => {
                    setTaskRecurrence(next);
                    if (next && !scheduledOn) setScheduledOn(nextRoundHour());
                  }}
                />
              </ListGroup>
            </View>
            <MoreRow open={more} count={moreCount} onPress={() => setMore((value) => !value)} />
          </View>
        ) : null}

        {kind === "reminder" ? (
          <View style={styles.groups}>
            <ListGroup>
              <ListRow
                title="Notify at"
                trailing={scheduledOn ? (taskTimeOnly ? formatTime(scheduledOn.toISOString()) : formatDateValue(scheduledOn, true)) : "Pick a time"}
                onPress={() => setPicking("schedule")}
              />
              <RepeatRow
                value={taskRecurrence}
                anchor={taskAnchor}
                subtitle={title.trim() || undefined}
                onChange={(next) => {
                  setTaskRecurrence(next);
                  if (next && !scheduledOn) setScheduledOn(nextRoundHour());
                }}
              />
              <PriorityRow priority={priority} onPress={() => setPicking("priority")} />
              {list.length > 0 ? <ListRow title="Workspace" trailing={selectedWorkspace?.name ?? "None"} onPress={() => setPicking("workspace")} /> : null}
            </ListGroup>
            <GroupHint>Pings at this time. It does not reserve a work block.</GroupHint>
          </View>
        ) : null}

        {kind === "event" ? (
          <View style={styles.groups}>
            <ListGroup>
              <ListRow
                title="Starts"
                trailing={eventRecurrence && !allDay ? formatTime(eventStart.toISOString()) : formatDateValue(eventStart, !allDay)}
                onPress={() => setPicking("eventStart")}
              />
              {!allDay ? <ListRow title="Duration" trailing={formatDuration(eventMinutes) ?? `${eventMinutes}m`} onPress={() => setPicking("eventDuration")} /> : null}
              <SwitchRow title="All day" value={allDay} onChange={setAllDay} />
              <RepeatRow value={eventRecurrence} anchor={eventStart} subtitle={title.trim() || undefined} onChange={setEventRecurrence} />
            </ListGroup>
            <ListGroup>
              <ListRow title="Workspace" trailing={eventWorkspace?.name ?? "None"} onPress={() => setPicking("eventWorkspace")} />
              {eventScopedProjects.length > 0 ? (
                <ListRow title="Project" trailing={<RowValue text={eventProject?.title ?? "None"} dot={eventProject?.color} />} onPress={() => setPicking("eventProject")} />
              ) : null}
              <ListRow title="Colour" trailing={<RowValue text={eventColor ? colorName(eventColor) : "Auto"} dot={eventColor || undefined} />} onPress={() => setPicking("eventColor")} />
            </ListGroup>
          </View>
        ) : null}

        {(kind === "doc" || kind === "sheet") && list.length > 0 ? (
          <ListGroup>
            <ListRow title="Workspace" trailing={selectedWorkspace?.name ?? "Select"} onPress={() => setPicking("workspace")} />
            <TemplateField templates={fileTemplates} value={templateId} onChange={setTemplateId} />
          </ListGroup>
        ) : null}

        {more && kind === "task" ? (
          <Animated.View entering={expandEntering(Boolean(reduceMotion))} style={styles.groups}>
            <View style={styles.section}>
              <GroupLabel>Auto-schedule</GroupLabel>
              <ListGroup>
                <ListRow title="Start date" trailing={formatDateValue(startDate)} onPress={() => setPicking("startDate")} />
                <ListRow title="Earliest start" trailing={formatDateValue(earliestStartAt, true)} onPress={() => setPicking("earliest")} />
                <ListRow
                  title="Work hours"
                  trailing={
                    <View style={styles.pills}>
                      <TimeField compact clearable label="Work from" placeholder="Any" value={preferFrom ? clockValue(preferFrom) : ""} onChange={(next) => setPreferFrom(clockDate(next))} />
                      <Text style={styles.pillDash}>–</Text>
                      <TimeField compact clearable label="Work until" placeholder="Any" value={preferTo ? clockValue(preferTo) : ""} onChange={(next) => setPreferTo(clockDate(next))} />
                    </View>
                  }
                />
              </ListGroup>
              <GroupHint>
                {taskRecurrence
                  ? "Each occurrence starts at its scheduled time. Auto-schedule keeps that block for this task."
                  : "Auto-schedule places the work after the start and inside these hours."}
              </GroupHint>
            </View>
            {detailsReady ? (
              <>
                <ListGroup>
                  <LabelsRow workspace={selectedWorkspace} workspaceId={activeWorkspaceId} labelIds={labelIds} onLabelIds={setLabelIds} />
                </ListGroup>
                <CustomFieldsGroup workspace={selectedWorkspace} workspaceId={activeWorkspaceId} values={customFieldValues} onValues={setCustomFieldValues} />
              </>
            ) : null}
          </Animated.View>
        ) : null}
      </Animated.View>
      )}
      </Animated.View>

      {/* Pickers: opened from inside this sheet, each one takes its place
          with a back arrow instead of stacking a second sheet on top. */}
      <BottomSheet open={picking === "workspace"} onClose={() => setPicking(null)} title="Workspace">
        {list.map((workspace) => (
          <SheetOption
            key={workspace.id}
            selected={workspace.id === activeWorkspaceId}
            onSelect={() => {
              setWorkspaceId(workspace.id);
              setPicking(null);
            }}
          >
            {workspace.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "project"} onClose={() => setPicking(null)} title="Project">
        <SheetOption
          selected={!projectId}
          onSelect={() => {
            setProjectId("");
            setStageId("");
            setPicking(null);
          }}
        >
          No project
        </SheetOption>
        {scopedProjects.map((project) => (
          <SheetOption
            key={project.id}
            selected={project.id === projectId}
            leading={project.color ? <Dot color={project.color} /> : undefined}
            onSelect={() => {
              setProjectId(project.id);
              setStageId("");
              setPicking(null);
            }}
          >
            {project.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "status"} onClose={() => setPicking(null)} title="Status">
        {(selectedWorkspace?.status ?? []).map((status) => (
          <SheetOption
            key={status.id}
            selected={status.id === statusId}
            leading={<Dot color={status.color} />}
            onSelect={() => {
              setStatusId(status.id);
              setPicking(null);
            }}
          >
            {status.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "stage"} onClose={() => setPicking(null)} title="Stage">
        <SheetOption selected={!stageId} onSelect={() => { setStageId(""); setPicking(null); }}>
          No stage
        </SheetOption>
        {stages.map((stage) => (
          <SheetOption
            key={stage.id}
            selected={stage.id === stageId}
            onSelect={() => {
              setStageId(stage.id);
              setPicking(null);
            }}
          >
            {stage.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "priority"} onClose={() => setPicking(null)} title="Priority">
        {PRIORITY_ORDER.map((level) => (
          <SheetOption
            key={level}
            selected={priority === level}
            leading={<Flag size={16} color={PRIORITY_META[level].color} />}
            onSelect={() => {
              setPriority(level as (typeof PRIORITIES)[number]);
              setPicking(null);
            }}
          >
            {PRIORITY_META[level].label}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "duration"} onClose={() => setPicking(null)} title="Duration">
        {suggested ? (
          <SheetOption
            leading={<Sparkles size={16} color={colors.primary} />}
            selected={false}
            onSelect={() => {
              setDuration(suggested);
              setPicking(null);
            }}
          >
            {`Suggested: ${formatDuration(suggested) ?? `${suggested}m`}`}
          </SheetOption>
        ) : null}
        {DURATION_PRESETS.filter((minutes) => minutes > 0).map((minutes) => (
          <SheetOption
            key={minutes}
            selected={duration === minutes}
            onSelect={() => {
              setDuration(minutes);
              setPicking(null);
            }}
          >
            {formatDuration(minutes) ?? `${minutes}m`}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "eventDuration"} onClose={() => setPicking(null)} title="Duration">
        {DURATION_PRESETS.filter((minutes) => minutes > 0).map((minutes) => (
          <SheetOption
            key={minutes}
            selected={eventDuration === minutes}
            onSelect={() => {
              setEventDuration(minutes);
              setPicking(null);
            }}
          >
            {formatDuration(minutes) ?? `${minutes}m`}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "eventWorkspace"} onClose={() => setPicking(null)} title="Workspace">
        <SheetOption
          selected={!eventWorkspaceId}
          onSelect={() => {
            setEventWorkspaceId("");
            setEventProjectId("");
            setPicking(null);
          }}
        >
          None
        </SheetOption>
        {list.map((workspace) => (
          <SheetOption
            key={workspace.id}
            selected={workspace.id === eventWorkspaceId}
            onSelect={() => {
              setEventWorkspaceId(workspace.id);
              const stillValid = projectList.some(
                (project) => project.id === eventProjectId && project.workspaceId === workspace.id,
              );
              if (!stillValid) setEventProjectId("");
              setPicking(null);
            }}
          >
            {workspace.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "eventProject"} onClose={() => setPicking(null)} title="Project">
        <SheetOption selected={!eventProjectId} onSelect={() => { setEventProjectId(""); setPicking(null); }}>
          None
        </SheetOption>
        {eventScopedProjects.map((project) => (
          <SheetOption
            key={project.id}
            selected={project.id === eventProjectId}
            leading={project.color ? <Dot color={project.color} /> : undefined}
            onSelect={() => {
              setEventProjectId(project.id);
              setPicking(null);
            }}
          >
            {project.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "eventColor"} onClose={() => setPicking(null)} title="Colour">
        <SheetOption selected={!eventColor} onSelect={() => { setEventColor(""); setPicking(null); }}>
          Auto
        </SheetOption>
        {ENTITY_COLORS.map((color) => (
          <SheetOption
            key={color}
            selected={eventColor === color}
            leading={<Dot color={color} />}
            onSelect={() => {
              setEventColor(color);
              setPicking(null);
            }}
          >
            {colorName(color)}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        key={picking ?? "closed"}
        open={picking === "due" || picking === "startDate" || picking === "schedule" || picking === "earliest" || picking === "preferFrom" || picking === "preferTo" || picking === "eventStart"}
        value={pickerValue}
        title={
          picking === "due"
            ? "Deadline"
            : picking === "startDate"
              ? "Start date"
              : picking === "schedule"
                ? isReminder ? "Notify at" : "Schedule"
                : picking === "earliest"
                  ? "Earliest start"
                  : picking === "preferFrom"
                    ? "Work from"
                    : picking === "preferTo"
                      ? "Work until"
                      : picking === "eventStart"
                        ? "Starts"
                        : undefined
        }
        mode={
          picking === "due" || picking === "startDate" || (picking === "eventStart" && allDay)
            ? "date"
            : picking === "preferFrom" || picking === "preferTo" || (picking === "schedule" && taskTimeOnly) ||
                (picking === "eventStart" && Boolean(eventRecurrence) && !allDay)
              ? "time"
              : "datetime"
        }
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (picking === "due") setDeadline(next);
          if (picking === "startDate") {
            setStartDate(next);
            if (next && scheduledOn && taskTimeOnly) {
              setScheduledOn(applyClock(next, scheduledOn));
            }
          }
          if (picking === "schedule") {
            if (taskTimeOnly && next) {
              setScheduledOn(applyClock(startDate ?? scheduledOn ?? new Date(), next));
            } else {
              setScheduledOn(next);
            }
          }
          if (picking === "earliest") setEarliestStartAt(next);
          if (picking === "preferFrom") setPreferFrom(next);
          if (picking === "preferTo") setPreferTo(next);
          if (picking === "eventStart" && next) {
            if (eventRecurrence && !allDay) {
              const combined = new Date(eventStart);
              combined.setHours(next.getHours(), next.getMinutes(), 0, 0);
              setEventStart(combined);
            } else {
              setEventStart(next);
            }
          }
        }}
      />
    </BottomSheet>
  );
}

function PriorityRow({ priority, onPress }: { priority: string; onPress: () => void }) {
  const meta = PRIORITY_META[priority];
  // Medium is the default: only a raised priority earns a colour.
  const tint = priority === "High" || priority === "Urgent" ? meta?.color : undefined;
  return (
    <ListRow
      title="Priority"
      trailing={
        <View style={styles.value}>
          {tint ? <Flag size={14} color={tint} /> : null}
          <Text numberOfLines={1} style={[styles.valueText, tint ? { color: tint } : null]}>{meta?.label ?? priority}</Text>
        </View>
      }
      onPress={onPress}
      accessibilityLabel={`Priority, ${meta?.label ?? priority}`}
    />
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

/** The last card of a new task: reveals Auto-schedule, Labels and Custom fields. */
function MoreRow({ open, count, onPress }: { open: boolean; count: number; onPress: () => void }) {
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <ListGroup>
      <ListRow
        title={open ? "Fewer options" : "More options"}
        meta={open ? undefined : "Auto-schedule window, labels, fields"}
        trailing={
          <View style={styles.value}>
            {count > 0 && !open ? <Text style={styles.valueText}>{count} set</Text> : null}
            <Icon size={16} color={colors.mutedForeground} />
          </View>
        }
        chevron={false}
        onPress={onPress}
        accessibilityLabel={open ? "Hide more options" : "Show more options"}
        testID="quick-add-more"
      />
    </ListGroup>
  );
}

function clockDate(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const next = new Date();
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return next;
}

/** The line in the action bar: where the new item lands and when. */
function quickAddSummary(input: {
  kind: Kind;
  where: string;
  duration: number;
  deadline: Date | null;
  scheduledOn: Date | null;
  timeOnly: boolean;
  recurring: boolean;
  eventStart: Date;
  eventMinutes: number;
  allDay: boolean;
  template?: string;
}): { main: string; detail?: string } {
  const day = (value: Date) => formatShortDate(value.toISOString());
  const time = (value: Date) => formatTime(value.toISOString());
  switch (input.kind) {
    case "inbox":
      return { main: "Goes to your Inbox", detail: "Sort it later" };
    case "reminder":
      return {
        main: input.scheduledOn ? `Reminds you ${input.timeOnly ? `at ${time(input.scheduledOn)}` : `${day(input.scheduledOn)} at ${time(input.scheduledOn)}`}` : "Reminds you in an hour",
        detail: input.recurring ? "Repeats" : undefined,
      };
    case "event": {
      if (input.allDay) return { main: day(input.eventStart), detail: "All day" };
      const end = new Date(input.eventStart.getTime() + input.eventMinutes * 60_000);
      return { main: `${day(input.eventStart)}, ${time(input.eventStart)} to ${time(end)}`, detail: input.recurring ? "Repeats" : undefined };
    }
    case "doc":
    case "sheet":
      return { main: `In ${input.where}`, detail: input.template ?? (input.kind === "doc" ? "Blank doc" : "Blank sheet") };
    default: {
      const detail = input.scheduledOn
        ? `Scheduled ${input.timeOnly ? time(input.scheduledOn) : `${day(input.scheduledOn)} ${time(input.scheduledOn)}`}`
        : input.deadline
          ? `Auto-schedule finds ${formatDuration(input.duration) ?? `${input.duration}m`} before ${day(input.deadline)}`
          : "Auto-schedule can place it";
      return { main: `In ${input.where}`, detail };
    }
  }
}

const styles = createThemedStyleSheet((colors) => ({
  fields: { gap: 18 },
  titleBlock: { gap: 4 },
  descriptionBridge: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.popover },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  kind: {
    width: "31%",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 88,
    borderRadius: 16,
    backgroundColor: colors.muted,
    paddingVertical: 10,
  },
  kindSelected: { backgroundColor: colors.accent },
  kindIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  kindIconSelected: { backgroundColor: colors.popover },
  kindText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  kindTextSelected: { color: colors.primary, fontWeight: "600" },
  kindSwitch: {
    alignSelf: "flex-start",
    minHeight: 34,
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
  },
  kindSwitchText: { color: colors.accentForeground, fontSize: 15, fontWeight: "600" },
  groups: { gap: 14 },
  section: { gap: 6 },
  value: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  valueText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  pillDash: { color: colors.mutedForeground, fontSize: 13 },
  actionBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  summary: { flex: 1, minWidth: 0, gap: 2 },
  summaryMain: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  summaryDetail: { color: colors.mutedForeground, fontSize: 12 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
}));
