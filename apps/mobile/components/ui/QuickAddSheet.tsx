import { startTransition, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Bell, CalendarClock, CalendarDays, Check, CircleDot, Clock, FileText, Flag, FolderKanban, Inbox, ListTodo, Palette, Sheet as SheetIcon } from "lucide-react-native";
import BottomSheet, { SheetOption } from "./BottomSheet";
import DateTimeSheet from "./DateTimeSheet";
import TaskMetaEditor from "./TaskMetaEditor";
import RecurrenceEditor from "./RecurrenceEditor";
import { Dot, Field, PrimaryButton, PropertyGroup, PropertyRow } from "./primitives";
import RichTextEditor from "../editor/RichTextEditor";
import AnimatedPressable from "./AnimatedPressable";
import { emptyCustomFieldDrafts, filledCustomFieldValues } from "../../lib/customFields";
import { isRichContentEmpty } from "../../lib/richText";
import type { DocContent } from "../../lib/types";
import { useCreateDoc, useCreateEvent, useCreateSheet, useCreateTask, useAddBlock, useProjectsQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildRecurrenceInput, type RecurrenceDraft } from "../../lib/recurrence";
import { sheetHref } from "../../lib/sheet";
import { formatDuration, formatShortDate, formatTime, PRIORITY_META, PRIORITY_ORDER, toDateInputValue } from "../../lib/format";
import type { CustomFieldValueInput } from "../../lib/types";
import type { QuickAddPreset } from "../../lib/quickAddIntent";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { ENTITY_COLORS } from "../../lib/entityColor";
import { expandEntering, listLayout, pageDuration } from "../../lib/motion";

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
  const createDoc = useCreateDoc();
  const createSheet = useCreateSheet();
  const addBlock = useAddBlock();
  const reduceMotion = useReducedMotion();

  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionRich, setDescriptionRich] = useState<DocContent>({ type: "doc", content: [{ type: "paragraph" }] });
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
  const [picking, setPicking] = useState<
    | "due"
    | "startDate"
    | "schedule"
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
  const [phase, setPhase] = useState<"menu" | "form">("menu");
  const [selectedKind, setSelectedKind] = useState<Kind | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);

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
  const pending = createTask.isPending || createEvent.isPending || createDoc.isPending || createSheet.isPending;

  const isReminder = kind === "reminder";
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
    setEditorOpen(false);
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
    setPhase("menu");
    setSelectedKind(null);
    setEditorOpen(false);
    setDetailsReady(false);
  }

  function pickKind(value: Kind) {
    if (value === "reminder") turnIntoReminder();
    else if (value === "task" && isReminder) addDuration();
    else setKind(value);
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
    setDescriptionRich({ type: "doc", content: [{ type: "paragraph" }] });
    setNoteSync((value) => value + 1);
    setProjectId("");
    setStageId("");
    setPriority("Medium");
    setDuration(30);
    setStartDate(null);
    setDeadline(null);
    setScheduledOn(null);
    setLabelIds([]);
    setTaskRecurrence(null);
    setEventRecurrence(null);
    setEventDuration(60);
    setAllDay(false);
    setEventStart(nextRoundHour());
    setEventWorkspaceId("");
    setEventColor("");
    setEventProjectId("");
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
    if (kind === "inbox") {
      await createTask.mutateAsync({ name, kind: "inbox", priorityLevel: priority });
      finish("/(app)/inbox");
      return;
    }
    if (kind === "task" || kind === "reminder") {
      if (!isReminder && !activeWorkspaceId) return;
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
    if (kind === "doc") {
      const doc = await createDoc.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
      reset();
      onClose();
      router.push(`/(app)/docs/${doc.id}`);
      return;
    }
    const sheet = await createSheet.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
    reset();
    onClose();
    router.push(sheetHref(sheet.id));
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
          : picking === "eventStart"
            ? eventStart
            : null;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={closeSheet}
        onClosed={finishClose}
        title={phase === "menu" ? "New" : `New ${kind}`}
        footer={
          phase === "form" ? (
          <View style={{ gap: 8 }}>
            <PrimaryButton
              label={pending ? "Saving…" : kind === "reminder" ? "Add reminder" : `Add ${kind}`}
              disabled={!title.trim() || pending || (((kind === "task" && !isReminder) || kind === "doc" || kind === "sheet") && !activeWorkspaceId)}
              onPress={() => void submit()}
            />
            <View style={styles.hintRow}>
              <Check size={14} color={colors.mutedForeground} />
              <Text style={styles.hint}>
                {kind === "reminder" ? "Shows on the calendar at that time" : "Creates it in your workspace immediately"}
              </Text>
            </View>
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
                <item.Icon size={20} color={selectedKind === item.value ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.kindText, selectedKind === item.value && styles.kindTextSelected]}>{item.label}</Text>
              </AnimatedPressable>
          ))}
        </Animated.View>
        ) : (
        <Animated.View key={`form-${kind}`} entering={expandEntering(Boolean(reduceMotion))} style={styles.fields}>
        <AnimatedPressable onPress={() => { setSelectedKind(null); setPhase("menu"); setEditorOpen(false); }} style={styles.changeType}>
          <Text style={styles.changeTypeText}>← Change type</Text>
        </AnimatedPressable>
        <View style={styles.objectiveCard}>
          <Text style={styles.cardEyebrow}>
            {kind === "task" ? "TASK OBJECTIVE" : kind === "event" ? "EVENT TITLE" : kind === "reminder" ? "REMINDER" : `${kind.toUpperCase()} TITLE`}
          </Text>
          <Field
            bare
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
            placeholder={
              kind === "task"
                ? "What needs to be done?"
                : kind === "reminder"
                  ? "What should Timely remind you about?"
                  : kind === "event"
                    ? "Event title"
                    : `Untitled ${kind}`
            }
          />
        </View>

        {kind === "task" || kind === "reminder" ? (
          <View style={styles.descriptionCard}>
            <View style={styles.descriptionHeader}>
              <Text style={styles.cardEyebrow}>DESCRIPTION</Text>
              {editorOpen ? <Text style={styles.markdownLabel}>Markdown enabled</Text> : null}
            </View>
          {editorOpen ? (
            <RichTextEditor
              compact
              content={descriptionRich}
              syncKey={noteSync}
              placeholder="Description. Type '/' for blocks, markdown welcome…"
              onChange={({ content, plainText }) => {
                setDescriptionRich(content);
                setDescription(plainText);
              }}
            />
          ) : (
            <Field
              bare
              multiline
              value={description}
              onChangeText={setDescription}
              onFocus={() => setEditorOpen(true)}
              autoCapitalize="sentences"
              placeholder="Add a description…"
            />
          )}
          </View>
        ) : kind === "event" ? (
          <View style={styles.descriptionCard}>
            <Text style={styles.cardEyebrow}>DESCRIPTION</Text>
            <Field
              bare
              value={description}
              onChangeText={setDescription}
              multiline
              autoCapitalize="sentences"
              placeholder="Notes, location, links…"
            />
          </View>
        ) : null}

        {(kind === "doc" || kind === "sheet") && list.length > 0 ? (
          <PropertyGroup>
            <PropertyRow
              icon={<FolderKanban size={16} color={colors.mutedForeground} />}
              label="Workspace"
              value={selectedWorkspace?.name ?? "Select workspace"}
              onPress={() => setPicking("workspace")}
            />
          </PropertyGroup>
        ) : null}

        {kind === "task" || kind === "reminder" ? (
          <View style={{ gap: 10 }}>
            <PropertyGroup>
              {!isReminder ? (
                <PropertyRow
                  icon={<FolderKanban size={16} color={colors.mutedForeground} />}
                  label="Workspace"
                  value={selectedWorkspace?.name ?? "Select workspace"}
                  onPress={() => setPicking("workspace")}
                />
              ) : null}
              {!isReminder && (selectedWorkspace?.status ?? []).length > 0 ? (
                <PropertyRow
                  icon={<CircleDot size={16} color={selectedWorkspace?.status?.find((status) => status.id === statusId)?.color || colors.mutedForeground} />}
                  label="Status"
                  value={selectedWorkspace?.status?.find((status) => status.id === statusId)?.name ?? "None"}
                  swatch={selectedWorkspace?.status?.find((status) => status.id === statusId)?.color}
                  onPress={() => setPicking("status")}
                />
              ) : null}
              <PropertyRow
                icon={<Flag size={16} color={colors.mutedForeground} />}
                label="Priority"
                value={PRIORITY_META[priority]?.label ?? priority}
                onPress={() => setPicking("priority")}
              />
              {!isReminder && scopedProjects.length > 0 ? (
                <PropertyRow
                  icon={<ListTodo size={16} color={colors.mutedForeground} />}
                  label="Project"
                  value={selectedProject?.title ?? "None"}
                  onPress={() => setPicking("project")}
                />
              ) : null}
              {!isReminder && stages.length > 0 ? (
                <PropertyRow
                  icon={<ListTodo size={16} color={colors.mutedForeground} />}
                  label="Stage"
                  value={stages.find((stage) => stage.id === stageId)?.name ?? "None"}
                  onPress={() => setPicking("stage")}
                />
              ) : null}
              {isReminder && list.length > 0 ? (
                <PropertyRow
                  icon={<FolderKanban size={16} color={colors.mutedForeground} />}
                  label="Workspace"
                  value={selectedWorkspace?.name ?? "None"}
                  onPress={() => setPicking("workspace")}
                />
              ) : null}
              {!isReminder ? (
                <PropertyRow
                  icon={<Clock size={16} color={colors.mutedForeground} />}
                  label="Duration"
                  value={formatDuration(duration) ?? `${duration}m`}
                  onPress={() => setPicking("duration")}
                />
              ) : null}
              <PropertyRow
                icon={<CalendarDays size={16} color={colors.mutedForeground} />}
                label="Start date"
                value={formatDateValue(startDate)}
                onPress={() => setPicking("startDate")}
              />
              <PropertyRow
                icon={<CalendarDays size={16} color={colors.mutedForeground} />}
                label="Deadline"
                value={formatDateValue(deadline)}
                onPress={() => setPicking("due")}
              />
            </PropertyGroup>

            {detailsReady ? (
              <RecurrenceEditor
                value={taskRecurrence}
                onChange={(next) => {
                  setTaskRecurrence(next);
                  if (next && !scheduledOn) setScheduledOn(nextRoundHour());
                }}
                anchor={taskAnchor}
              />
            ) : null}

            <Text style={styles.section}>{isReminder ? "Reminder" : "Schedule"}</Text>
            <PropertyGroup>
              {isReminder ? (
                <PropertyRow
                  icon={<Clock size={16} color={colors.mutedForeground} />}
                  label={taskTimeOnly ? "Time" : "Notify at"}
                  value={
                    scheduledOn
                      ? taskTimeOnly
                        ? formatTime(scheduledOn.toISOString())
                        : formatDateValue(scheduledOn, true)
                      : "Pick a time"
                  }
                  onPress={() => setPicking("schedule")}
                />
              ) : (
                <PropertyRow
                  icon={<CalendarDays size={16} color={colors.mutedForeground} />}
                  label={taskTimeOnly ? "Time" : "Schedule"}
                  value={
                    taskTimeOnly
                      ? scheduledOn
                        ? formatTime(scheduledOn.toISOString())
                        : "None"
                      : formatDateValue(scheduledOn, true)
                  }
                  onPress={() => setPicking("schedule")}
                />
              )}
            </PropertyGroup>
            <Text style={styles.hint}>
              {isReminder
                ? taskRecurrence
                  ? "Each repeat pings at this time. No work block is reserved."
                  : "Pings at this date and time. Does not reserve a work block."
                : taskRecurrence
                  ? "Each occurrence starts at this time. Auto-schedule keeps that block for this task."
                  : "Tasks appear on the calendar once scheduled, by hand or with Auto-schedule."}
            </Text>

            {detailsReady && !isReminder ? (
              <>
                <View style={styles.metaPanel}>
                  <TaskMetaEditor
                    workspace={selectedWorkspace}
                    workspaceId={activeWorkspaceId}
                    labelIds={labelIds}
                    onLabelIds={setLabelIds}
                    values={customFieldValues}
                    onValues={setCustomFieldValues}
                    showCustomFields={false}
                  />
                </View>
                <View style={styles.metaPanel}>
                  <TaskMetaEditor
                    workspace={selectedWorkspace}
                    workspaceId={activeWorkspaceId}
                    labelIds={labelIds}
                    onLabelIds={setLabelIds}
                    values={customFieldValues}
                    onValues={setCustomFieldValues}
                    showLabels={false}
                  />
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {kind === "event" ? (
          <View style={{ gap: 10 }}>
            <PropertyGroup>
              <PropertyRow
                icon={<CalendarDays size={16} color={colors.mutedForeground} />}
                label={eventRecurrence && !allDay ? "Time" : "Starts"}
                value={
                  eventRecurrence && !allDay
                    ? formatTime(eventStart.toISOString())
                    : formatDateValue(eventStart, !allDay)
                }
                onPress={() => setPicking("eventStart")}
              />
              <PropertyRow
                icon={<Clock size={16} color={colors.mutedForeground} />}
                label="Duration"
                value={formatDuration(eventMinutes) ?? `${eventMinutes}m`}
                onPress={() => setPicking("eventDuration")}
              />
              <PropertyRow
                icon={<CalendarClock size={16} color={colors.mutedForeground} />}
                label="All day"
                value={allDay ? "On" : "Off"}
                onPress={() => setAllDay((value) => !value)}
              />
              <PropertyRow
                icon={<FolderKanban size={16} color={colors.mutedForeground} />}
                label="Workspace"
                value={list.find((workspace) => workspace.id === eventWorkspaceId)?.name ?? "None"}
                onPress={() => setPicking("eventWorkspace")}
              />
              <PropertyRow
                icon={<Palette size={16} color={eventColor || colors.mutedForeground} />}
                label="Color"
                value={eventColor ? "Custom" : "Auto"}
                swatch={eventColor || undefined}
                onPress={() => setPicking("eventColor")}
              />
              {eventScopedProjects.length > 0 ? (
                <PropertyRow
                  icon={<ListTodo size={16} color={colors.mutedForeground} />}
                  label="Project"
                  value={projectList.find((project) => project.id === eventProjectId)?.title ?? "None"}
                  onPress={() => setPicking("eventProject")}
                />
              ) : null}
            </PropertyGroup>
            {detailsReady ? (
              <RecurrenceEditor value={eventRecurrence} onChange={setEventRecurrence} anchor={eventStart} />
            ) : null}
            <Text style={styles.hint}>
              {eventRecurrence && !allDay
                ? "Each occurrence starts at this time. Dates come from the repeat rule."
                : "Events block time on the calendar; Auto-schedule plans tasks around them."}
            </Text>
          </View>
        ) : null}

        </Animated.View>
        )}
        </Animated.View>
      </BottomSheet>
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
            onSelect={() => {
              setEventProjectId(project.id);
              setPicking(null);
            }}
          >
            {project.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picking === "eventColor"} onClose={() => setPicking(null)} title="Color">
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
            {color}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        key={picking ?? "closed"}
        open={picking === "due" || picking === "startDate" || picking === "schedule" || picking === "eventStart"}
        value={pickerValue}
        mode={
          picking === "due" || picking === "startDate" || (picking === "eventStart" && allDay)
            ? "date"
            : (picking === "schedule" && taskTimeOnly) ||
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
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  fields: { gap: 16 },
  objectiveCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, gap: 7 },
  descriptionCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, gap: 10 },
  descriptionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardEyebrow: { color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  markdownLabel: { color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 9 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  kind: {
    width: "31%",
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 14,
  },
  kindSelected: { borderColor: colors.primary, backgroundColor: colors.accent },
  kindText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  kindTextSelected: { color: colors.primary, fontWeight: "700" },
  changeType: { alignSelf: "flex-start", paddingVertical: 4, paddingRight: 12 },
  changeTypeText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  metaPanel: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  section: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.9, marginTop: 4 },
  hintRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10 },
  hint: { color: colors.mutedForeground, fontSize: 12 },
}));
