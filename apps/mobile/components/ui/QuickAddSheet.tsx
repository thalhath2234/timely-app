import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarClock, Check, FileText, ListTodo, Sheet as SheetIcon } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import CustomFieldEditor from "./CustomFieldEditor";
import DateTimeSheet from "./DateTimeSheet";
import RecurrenceEditor from "./RecurrenceEditor";
import { Chip, Field, PrimaryButton, SectionLabel, Select } from "./primitives";
import { emptyCustomFieldDrafts, filledCustomFieldValues } from "../../lib/customFields";
import { useCreateDoc, useCreateEvent, useCreateSheet, useCreateTask, useProjectsQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildRecurrenceInput, type RecurrenceDraft } from "../../lib/recurrence";
import { sheetHref } from "../../lib/sheet";
import { formatDuration, formatShortDate, formatTime, toDateInputValue } from "../../lib/format";
import type { CustomFieldValueInput } from "../../lib/types";
import { colors } from "../../lib/theme";

type Kind = "task" | "event" | "doc" | "sheet";
const KINDS: { value: Kind; label: string; Icon: typeof ListTodo }[] = [
  { value: "task", label: "Task", Icon: ListTodo },
  { value: "event", label: "Event", Icon: CalendarClock },
  { value: "doc", label: "Doc", Icon: FileText },
  { value: "sheet", label: "Sheet", Icon: SheetIcon },
];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

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

export default function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const workspaces = useWorkspacesQuery();
  const projects = useProjectsQuery();
  const createTask = useCreateTask();
  const createEvent = useCreateEvent();
  const createDoc = useCreateDoc();
  const createSheet = useCreateSheet();

  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
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
  const pending = createTask.isPending || createEvent.isPending || createDoc.isPending || createSheet.isPending;

  const taskAnchor = useMemo(() => scheduledOn ?? nextRoundHour(), [scheduledOn]);
  const eventMinutes = Math.max(15, eventDuration || 60);

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
    setLabelIds([]);
    setCustomFieldValues(emptyCustomFieldDrafts(selectedWorkspace.customFields));
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (open) setEventStart(nextRoundHour());
  }, [open]);

  function reset() {
    setTitle("");
    setDescription("");
    setProjectId("");
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
    if (kind === "task") {
      if (!activeWorkspaceId) return;
      const recurrence = buildRecurrenceInput(taskRecurrence, taskAnchor);
      await createTask.mutateAsync({
        name,
        description: description.trim() || "",
        workspaceId: activeWorkspaceId,
        projectId: projectId || undefined,
        statusId: statusId || undefined,
        priorityLevel: priority,
        startDate: startDate ? toDateInputValue(startDate) : undefined,
        deadline: deadline ? toDateInputValue(deadline) : undefined,
        scheduledOn: !recurrence && scheduledOn ? scheduledOn.toISOString() : undefined,
        duration,
        labelIds: labelIds.map((id) => ({ id })),
        customFieldValues: filledCustomFieldValues(customFieldValues),
        recurrence: recurrence ?? undefined,
      });
      finish("/(app)/(tabs)/tasks");
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
              <Pressable key={item.value} onPress={() => setKind(item.value)} style={[styles.kind, on && styles.kindOn]}>
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
          placeholder={kind === "task" ? "Task name" : kind === "event" ? "Event title" : `Untitled ${kind}`}
        />

        {kind === "task" || kind === "event" ? (
          <Field
            value={description}
            onChangeText={setDescription}
            multiline
            autoCapitalize="sentences"
            placeholder={kind === "task" ? "Description" : "Notes, location, links..."}
          />
        ) : null}

        {kind === "task" || kind === "doc" || kind === "sheet" ? (
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
          ) : null
        ) : null}

        {kind === "task" ? (
          <View style={{ gap: 10 }}>
            {scopedProjects.length > 0 ? (
              <>
                <SectionLabel>Project</SectionLabel>
                <View style={styles.row}>
                  <Chip label="No project" active={!projectId} onPress={() => setProjectId("")} />
                  {scopedProjects.map((project) => (
                    <Chip
                      key={project.id}
                      label={project.title}
                      active={project.id === projectId}
                      onPress={() => setProjectId(project.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {(selectedWorkspace?.status ?? []).length > 0 ? (
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

            <SectionLabel>Duration</SectionLabel>
            <View style={styles.row}>
              {DURATION_PRESETS.map((minutes) => (
                <Chip
                  key={minutes}
                  label={formatDuration(minutes) ?? `${minutes}m`}
                  active={duration === minutes}
                  onPress={() => setDuration(minutes)}
                />
              ))}
            </View>
            <Stepper value={duration} suffix="min" step={15} min={0} onChange={setDuration} />

            <Pressable onPress={() => setPicking("startDate")} style={styles.meta}>
              <Text style={styles.metaLabel}>Start date</Text>
              <Text style={styles.metaValue}>{formatDateValue(startDate)}</Text>
            </Pressable>
            <Pressable onPress={() => setPicking("due")} style={styles.meta}>
              <Text style={styles.metaLabel}>Deadline</Text>
              <Text style={styles.metaValue}>{formatDateValue(deadline)}</Text>
            </Pressable>
            <Pressable onPress={() => setPicking("schedule")} style={styles.meta}>
              <Text style={styles.metaLabel}>{taskRecurrence ? "First on" : "Schedule"}</Text>
              <Text style={styles.metaValue}>{formatDateValue(scheduledOn, true)}</Text>
            </Pressable>

            <RecurrenceEditor value={taskRecurrence} onChange={setTaskRecurrence} anchor={taskAnchor} />
            <Text style={styles.hint}>
              {taskRecurrence
                ? "Each occurrence shows on the calendar and is completed on its own."
                : "Tasks appear on the calendar once scheduled, by hand or with Auto-schedule."}
            </Text>

            {(selectedWorkspace?.lables ?? []).length > 0 ? (
              <>
                <SectionLabel>Labels</SectionLabel>
                <View style={styles.row}>
                  {(selectedWorkspace?.lables ?? []).map((label) => {
                    const active = labelIds.includes(label.id);
                    return (
                      <Chip
                        key={label.id}
                        label={label.name}
                        color={label.color}
                        active={active}
                        onPress={() =>
                          setLabelIds((current) =>
                            active ? current.filter((id) => id !== label.id) : [...current, label.id],
                          )
                        }
                      />
                    );
                  })}
                </View>
              </>
            ) : null}

            <CustomFieldEditor
              fields={selectedWorkspace?.customFields ?? []}
              values={customFieldValues}
              onChange={setCustomFieldValues}
            />
          </View>
        ) : null}

        {kind === "event" ? (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setPicking("eventStart")} style={styles.meta}>
              <Text style={styles.metaLabel}>Starts</Text>
              <Text style={styles.metaValue}>{formatDateValue(eventStart, !allDay)}</Text>
            </Pressable>
            <SectionLabel>Duration</SectionLabel>
            <View style={styles.row}>
              {DURATION_PRESETS.map((minutes) => (
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
              Events block time on the calendar; Auto-schedule plans tasks around them.
            </Text>
          </View>
        ) : null}

        </View>
        <View style={{ height: 8 }} />
        <PrimaryButton
          label={pending ? "Saving…" : `Add ${kind}`}
          disabled={!title.trim() || pending || (kind === "task" && !activeWorkspaceId)}
          onPress={() => void submit()}
        />
        <View style={styles.hintRow}>
          <Check size={14} color={colors.mutedForeground} />
          <Text style={styles.hint}>Creates it in your workspace immediately</Text>
        </View>
      </BottomSheet>
      <DateTimeSheet
        open={picking !== null}
        value={pickerValue}
        mode={picking === "due" || picking === "startDate" || (picking === "eventStart" && allDay) ? "date" : "datetime"}
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (picking === "due") setDeadline(next);
          if (picking === "startDate") setStartDate(next);
          if (picking === "schedule") setScheduledOn(next);
          if (picking === "eventStart" && next) setEventStart(next);
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

const styles = StyleSheet.create({
  fields: { gap: 14 },
  kinds: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kind: {
    flex: 1,
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
});
