import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, CalendarClock, Check, FileText, Inbox, ListTodo, Sheet as SheetIcon } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import DateTimeSheet from "./DateTimeSheet";
import TaskMetaEditor from "./TaskMetaEditor";
import RecurrenceEditor from "./RecurrenceEditor";
import { Chip, Field, PrimaryButton, SectionLabel, Select } from "./primitives";
import RichTextEditor from "../editor/RichTextEditor";
import { emptyCustomFieldDrafts, filledCustomFieldValues } from "../../lib/customFields";
import { isRichContentEmpty } from "../../lib/richText";
import type { DocContent } from "../../lib/types";
import { useCreateDoc, useCreateEvent, useCreateSheet, useCreateTask, useAddBlock, useProjectsQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildRecurrenceInput, type RecurrenceDraft } from "../../lib/recurrence";
import { sheetHref } from "../../lib/sheet";
import { formatDuration, formatShortDate, formatTime, toDateInputValue } from "../../lib/format";
import type { CustomFieldValueInput } from "../../lib/types";
import type { QuickAddPreset } from "../../lib/quickAddIntent";
import { colors, createThemedStyleSheet } from "../../lib/theme";

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
  const [picking, setPicking] = useState<"due" | "startDate" | "schedule" | "eventStart" | null>(null);

  const list = workspaces.data ?? [];
  const projectList = projects.data ?? [];
  const activeWorkspaceId = workspaceId || list[0]?.id || "";
  const selectedWorkspace = list.find((workspace) => workspace.id === activeWorkspaceId);
  const scopedProjects = projectList.filter((project) => project.workspaceId === activeWorkspaceId);
  const selectedProject = projectList.find((project) => project.id === projectId);
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
        workspaceId: eventWorkspaceId || undefined,
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
      <BottomSheet open={open} onClose={onClose} title="New">
        <View style={styles.kinds}>
          {KINDS.map((item) => {
            const on = item.value === kind;
            return (
              <Pressable
                key={item.value}
                onPress={() => {
                  if (item.value === "reminder") turnIntoReminder();
                  else if (item.value === "task" && isReminder) addDuration();
                  else setKind(item.value);
                }}
                style={[styles.kind, on && styles.kindOn]}
              >
                <item.Icon size={20} color={on ? colors.accentForeground : colors.mutedForeground} />
                <Text style={[styles.kindText, on && { color: colors.accentForeground }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.fields}>
        <Field
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder={
            kind === "task"
              ? "Task name"
              : kind === "reminder"
                ? "Reminder"
                : kind === "event"
                  ? "Event title"
                  : `Untitled ${kind}`
          }
        />

        {kind === "task" || kind === "reminder" ? (
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
        ) : kind === "event" ? (
          <Field
            value={description}
            onChangeText={setDescription}
            multiline
            autoCapitalize="sentences"
            placeholder="Notes, location, links..."
          />
        ) : null}

        {(kind === "doc" || kind === "sheet" || kind === "task" || kind === "reminder") &&
        list.length > 1 ? (
            <View>
              <SectionLabel>Workspace</SectionLabel>
              <Select
                value={activeWorkspaceId}
                onChange={setWorkspaceId}
                placeholder="Workspace"
                options={list.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              />
            </View>
        ) : null}

        {kind === "task" || kind === "reminder" ? (
          <View style={{ gap: 10 }}>
            {!isReminder && scopedProjects.length > 0 ? (
              <>
                <SectionLabel>Project</SectionLabel>
                <View style={styles.row}>
                  <Chip label="No project" active={!projectId} onPress={() => { setProjectId(""); setStageId(""); }} />
                  {scopedProjects.map((project) => (
                    <Chip
                      key={project.id}
                      label={project.title}
                      active={project.id === projectId}
                      onPress={() => {
                        setProjectId(project.id);
                        setStageId("");
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {!isReminder && stages.length > 0 ? (
              <>
                <SectionLabel>Stage</SectionLabel>
                <View style={styles.row}>
                  <Chip label="None" active={!stageId} onPress={() => setStageId("")} />
                  {stages.map((stage) => (
                    <Chip
                      key={stage.id}
                      label={stage.name}
                      active={stage.id === stageId}
                      onPress={() => setStageId(stage.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {!isReminder && (selectedWorkspace?.status ?? []).length > 0 ? (
              <>
                <SectionLabel>Status</SectionLabel>
                <View style={styles.row}>
                  {(selectedWorkspace?.status ?? []).map((status) => (
                    <Chip
                      key={status.id}
                      label={status.name}
                      color={status.color}
                      active={status.id === statusId}
                      onPress={() => setStatusId(status.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <SectionLabel>Priority</SectionLabel>
            <View style={styles.row}>
              {PRIORITIES.map((level) => (
                <Chip key={level} label={level} active={priority === level} onPress={() => setPriority(level)} />
              ))}
            </View>

            {isReminder ? (
              <Pressable onPress={() => setPicking("schedule")} style={styles.meta}>
                <Text style={styles.metaLabel}>Notify at</Text>
                <Text style={styles.metaValue}>
                  {scheduledOn ? formatDateValue(scheduledOn, true) : "Pick a time"}
                </Text>
              </Pressable>
            ) : (
              <>
                <SectionLabel>Duration</SectionLabel>
                <View style={styles.row}>
                  {DURATION_PRESETS.filter((minutes) => minutes > 0).map((minutes) => (
                    <Chip
                      key={minutes}
                      label={formatDuration(minutes) ?? `${minutes}m`}
                      active={duration === minutes}
                      onPress={() => setDuration(minutes)}
                    />
                  ))}
                </View>
                <Stepper value={Math.max(duration, 15)} suffix="min" step={15} min={15} onChange={setDuration} />
              </>
            )}

            {!isReminder ? (
              <>
            <Pressable onPress={() => setPicking("startDate")} style={styles.meta}>
              <Text style={styles.metaLabel}>Start date</Text>
              <Text style={styles.metaValue}>{formatDateValue(startDate)}</Text>
            </Pressable>
            <Pressable onPress={() => setPicking("due")} style={styles.meta}>
              <Text style={styles.metaLabel}>Deadline</Text>
              <Text style={styles.metaValue}>{formatDateValue(deadline)}</Text>
            </Pressable>
            <Pressable onPress={() => setPicking("schedule")} style={styles.meta}>
              <Text style={styles.metaLabel}>{taskTimeOnly ? "Time" : "Schedule"}</Text>
              <Text style={styles.metaValue}>
                {taskTimeOnly
                  ? scheduledOn
                    ? formatTime(scheduledOn.toISOString())
                    : "None"
                  : formatDateValue(scheduledOn, true)}
              </Text>
            </Pressable>
              </>
            ) : null}

            <RecurrenceEditor
              value={taskRecurrence}
              onChange={(next) => {
                setTaskRecurrence(next);
                if (next && !scheduledOn) setScheduledOn(nextRoundHour());
              }}
              anchor={taskAnchor}
            />
            <Text style={styles.hint}>
              {isReminder
                ? taskRecurrence
                  ? "Each repeat pings at this time. No work block is reserved."
                  : "Pings at this date and time. Does not reserve a work block."
                : taskRecurrence
                  ? "Each occurrence starts at this time. Auto-schedule keeps that block for this task."
                  : "Tasks appear on the calendar once scheduled, by hand or with Auto-schedule."}
            </Text>

            <TaskMetaEditor
              workspace={selectedWorkspace}
              workspaceId={activeWorkspaceId}
              labelIds={labelIds}
              onLabelIds={setLabelIds}
              values={customFieldValues}
              onValues={setCustomFieldValues}
            />
          </View>
        ) : null}

        {kind === "event" ? (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setPicking("eventStart")} style={styles.meta}>
              <Text style={styles.metaLabel}>
                {eventRecurrence && !allDay ? "Time" : "Starts"}
              </Text>
              <Text style={styles.metaValue}>
                {eventRecurrence && !allDay
                  ? formatTime(eventStart.toISOString())
                  : formatDateValue(eventStart, !allDay)}
              </Text>
            </Pressable>
            <SectionLabel>Duration</SectionLabel>
            <View style={styles.row}>
              {DURATION_PRESETS.filter((minutes) => minutes > 0).map((minutes) => (
                <Chip
                  key={minutes}
                  label={formatDuration(minutes) ?? `${minutes}m`}
                  active={eventDuration === minutes}
                  onPress={() => setEventDuration(minutes)}
                />
              ))}
            </View>
            <Stepper value={eventDuration} suffix={formatDuration(eventMinutes) ?? "min"} step={15} min={15} onChange={setEventDuration} />
            <Chip label={allDay ? "All day on" : "All day off"} active={allDay} onPress={() => setAllDay((value) => !value)} />
            <RecurrenceEditor value={eventRecurrence} onChange={setEventRecurrence} anchor={eventStart} />
            <SectionLabel>Workspace</SectionLabel>
            <Select
              value={eventWorkspaceId}
              onChange={setEventWorkspaceId}
              placeholder="None"
              options={[
                { value: "", label: "None" },
                ...list.map((workspace) => ({ value: workspace.id, label: workspace.name })),
              ]}
            />
            <Text style={styles.hint}>
              {eventRecurrence && !allDay
                ? "Each occurrence starts at this time. Dates come from the repeat rule."
                : "Events block time on the calendar; Auto-schedule plans tasks around them."}
            </Text>
          </View>
        ) : null}

        </View>
        <View style={{ height: 8 }} />
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
      </BottomSheet>
      <DateTimeSheet
        open={picking !== null}
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

function Stepper({
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - step))} style={styles.step}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>
        {value}
        {suffix ? ` ${suffix}` : ""}
      </Text>
      <Pressable onPress={() => onChange(value + step)} style={styles.step}>
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  fields: { gap: 14 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  kind: {
    width: "31%",
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
  },
  kindOn: { borderColor: colors.primary, backgroundColor: colors.accent },
  kindText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  meta: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLabel: { color: colors.mutedForeground, fontSize: 13 },
  metaValue: { color: colors.foreground, fontSize: 14 },
  metaAction: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  hintRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10 },
  hint: { color: colors.mutedForeground, fontSize: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.foreground, fontSize: 18, fontWeight: "600" },
  stepValue: { color: colors.foreground, fontSize: 14, fontWeight: "600", minWidth: 48 },
}));
