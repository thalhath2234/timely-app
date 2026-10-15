import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarClock, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import RecurrenceEditor from "../../../components/ui/RecurrenceEditor";
import { Chip, Field, PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import {
  useCalendarQuery,
  useDeleteEvent,
  useEditEventOccurrence,
  useEventQuery,
  useProjectsQuery,
  useSplitEventSeries,
  useUpdateEvent,
} from "../../../lib/hooks";
import { addDays, formatShortDate, formatTime, startOfDay } from "../../../lib/format";
import { buildRecurrenceInput, rruleToDraft, type RecurrenceDraft } from "../../../lib/recurrence";
import { ENTITY_COLORS, colorName } from "../../../lib/entityColor";
import { findEventItem, sameInstant, withTimeOfDay, withUntil } from "../../../lib/eventOccurrence";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function EventDetailScreen() {
  // `occurrence` is the original start of the date that was opened (see eventHref).
  const { id, occurrence } = useLocalSearchParams<{ id: string; occurrence?: string }>();
  const router = useRouter();
  const from = startOfDay(addDays(new Date(), -60));
  const to = addDays(new Date(), 120);
  const items = useCalendarQuery(from, to).data?.items ?? [];
  const item = findEventItem(items, id, occurrence);
  const fetched = useEventQuery(id);
  const event = fetched.data ?? item?.event;
  const rule = event?.recurrence ?? null;
  // Opened without an occurrence (search, a notification): the screen edits the series.
  const occurrenceItem =
    item?.kind === "eventOccurrence" && sameInstant(item.originalStart, occurrence) ? item : null;
  const originalStart = occurrenceItem?.originalStart ?? (rule && occurrence ? occurrence : null);
  const isOccurrence = Boolean(originalStart);
  // The series anchor (first date); "Entire series" keeps its date and takes the new time.
  const seriesAnchor = rule ? new Date(rule.dtstart) : event ? new Date(event.start) : null;
  const isFirst = !originalStart || !seriesAnchor || new Date(originalStart).getTime() <= seriesAnchor.getTime();
  // What the form starts from: the opened occurrence's own times, else the event's.
  const lengthMs = event ? new Date(event.end).getTime() - new Date(event.start).getTime() : 0;
  const baseStart = originalStart
    ? (occurrenceItem?.start ?? originalStart)
    : (event?.start ?? item?.start ?? null);
  const baseEnd = originalStart
    ? (occurrenceItem?.end ?? new Date(new Date(originalStart).getTime() + lengthMs).toISOString())
    : (event?.end ?? item?.end ?? null);
  const save = useUpdateEvent();
  const remove = useDeleteEvent();
  const editOcc = useEditEventOccurrence();
  const split = useSplitEventSeries();
  const projects = useProjectsQuery().data ?? [];
  const [title, setTitle] = useState(event?.title ?? item?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [color, setColor] = useState(event?.color ?? "");
  const [projectId, setProjectId] = useState(event?.projectId ?? "");
  const [start, setStart] = useState(baseStart ? new Date(baseStart) : new Date());
  const [end, setEnd] = useState(baseEnd ? new Date(baseEnd) : new Date());
  const [allDay, setAllDay] = useState(event?.allDay ?? item?.allDay ?? false);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft | null>(
    event?.recurrence ? rruleToDraft(event.recurrence.rrule, new Date(event.start)) : null,
  );
  const [scope, setScope] = useState<"this" | "future" | "all">("all");
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description);
    setColor(event.color ?? "");
    setProjectId(event.projectId ?? "");
    if (baseStart) setStart(new Date(baseStart));
    if (baseEnd) setEnd(new Date(baseEnd));
    setAllDay(event.allDay);
    setRecurrence(event.recurrence ? rruleToDraft(event.recurrence.rrule, new Date(event.start)) : null);
  }, [event?.id, event?.updatedAt, baseStart, baseEnd]);

  useAssistantScreen(event ? [
    contextChip("object", title || "Event", `events/${event.id}`),
    ...(event.workspaceId ? [contextChip("workspace", "Workspace", event.workspaceId)] : []),
    ...(projectId ? [contextChip("project", "Project", projectId)] : []),
    contextChip("draft", "Local event form", { title, description, start: start.toISOString(), end: end.toISOString(), allDay, scope, recurrence }),
  ] : []);

  if (fetched.isLoading && !event && !item) {
    return (
      <Screen>
        <MobileHeader title="Event" back large={false} />
        <EmptyState icon={CalendarClock} title="Opening event" description="Fetching the latest event…" />
      </Screen>
    );
  }

  if (!item && !event) {
    return (
      <Screen>
        <MobileHeader title="Event" back large={false} />
        <EmptyState icon={CalendarClock} title="Event not found" description="It may have been deleted." />
      </Screen>
    );
  }

  const scopedProjects = projects.filter(
    (project) => !event?.workspaceId || project.workspaceId === event.workspaceId,
  );

  // The API keeps only a new time per occurrence; title, notes, colour,
  // project, all-day and repeat live on the series, as on the web.
  const recurrenceAnchor = event ? new Date(event.start) : start;
  const savedRRule = rule
    ? (buildRecurrenceInput(rruleToDraft(rule.rrule, recurrenceAnchor), recurrenceAnchor)?.rrule ?? null)
    : null;
  const draftRRule = buildRecurrenceInput(recurrence, recurrenceAnchor)?.rrule ?? null;
  const seriesOnlyChange = Boolean(
    event &&
      (title !== event.title ||
        description !== event.description ||
        (color || "") !== (event.color ?? "") ||
        (projectId || null) !== (event.projectId ?? null) ||
        allDay !== event.allDay ||
        savedRRule !== draftRRule),
  );
  const effectiveScope = !isOccurrence || seriesOnlyChange ? "all" : scope;
  // A series edit changes the time of day; one occurrence can also move to another date.
  const timeOnly = Boolean(recurrence) && !allDay && effectiveScope !== "this";

  async function persist() {
    const extras = {
      title,
      description,
      color: color || "",
      projectId: projectId || null,
    };
    if (effectiveScope === "this" && originalStart) {
      const unchanged =
        baseStart !== null &&
        baseEnd !== null &&
        start.getTime() === new Date(baseStart).getTime() &&
        end.getTime() === new Date(baseEnd).getTime();
      if (unchanged) return;
      await editOcc.mutateAsync({
        id,
        originalStart,
        action: "move",
        newStart: start.toISOString(),
        newEnd: end.toISOString(),
      });
      return;
    }
    if (effectiveScope === "future" && originalStart && rule) {
      await split.mutateAsync({
        id,
        fromStart: originalStart,
        recurrence: { rrule: rule.rrule, timezone: rule.timezone },
        title,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      return;
    }
    // The whole series, opened from one of its dates: keep the series' first
    // date and take the new time of day.
    const seriesStart = isOccurrence && seriesAnchor ? withTimeOfDay(seriesAnchor, start) : start;
    const seriesEnd = new Date(seriesStart.getTime() + (end.getTime() - start.getTime()));
    save.mutate({
      id,
      data: {
        ...extras,
        start: seriesStart.toISOString(),
        end: seriesEnd.toISOString(),
        allDay,
        recurrence: buildRecurrenceInput(recurrence, seriesStart),
      },
    });
  }

  function removeEvent() {
    const done = { onSuccess: () => router.replace("/(app)/(tabs)/calendar") };
    if (isOccurrence && originalStart && scope === "this") {
      editOcc.mutate({ id, originalStart, action: "skip" }, done);
      return;
    }
    if (isOccurrence && originalStart && rule && scope === "future" && !isFirst) {
      const recurrence = {
        rrule: withUntil(rule.rrule, new Date(originalStart)),
        dtstart: rule.dtstart,
        timezone: rule.timezone,
      };
      save.mutate({ id, data: { recurrence } }, done);
      return;
    }
    remove.mutate(id, done);
  }

  const scopeLabel = (value: "this" | "future" | "all") =>
    value === "this" ? "This occurrence" : value === "future" ? "This and following" : "Entire series";
  const scopeOptions = (["this", "future", "all"] as const).filter((value) => value !== "future" || !isFirst);

  return (
    <Screen>
      <MobileHeader title="Event" back large={false} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Field value={title} onChangeText={setTitle} placeholder="Event title" autoCapitalize="sentences" />
        <Field value={description} onChangeText={setDescription} placeholder="Notes, location, links..." multiline autoCapitalize="sentences" />
        <SectionLabel>Color</SectionLabel>
        <View style={styles.row}>
          <Chip label="Auto" active={!color} onPress={() => setColor("")} />
          {ENTITY_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityLabel={`Color ${colorName(swatch)}`}
              onPress={() => setColor(swatch)}
              style={[styles.swatch, { backgroundColor: swatch }, color === swatch && styles.swatchOn]}
            />
          ))}
        </View>
        {scopedProjects.length > 0 ? (
          <>
            <SectionLabel>Project</SectionLabel>
            <View style={styles.row}>
              <Chip label="None" active={!projectId} onPress={() => setProjectId("")} />
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
        <Chip label={allDay ? "All day on" : "All day off"} active={allDay} onPress={() => setAllDay((v) => !v)} />
        <Pressable onPress={() => setPicking("start")} style={styles.meta}>
          <Text style={styles.label}>{timeOnly ? "Time" : "Starts"}</Text>
          <Text style={styles.value}>
            {timeOnly
              ? formatTime(start.toISOString())
              : `${formatShortDate(start.toISOString())}${allDay ? "" : ` ${formatTime(start.toISOString())}`}`}
          </Text>
        </Pressable>
        {timeOnly ? (
          <Pressable onPress={() => setPicking("end")} style={styles.meta}>
            <Text style={styles.label}>Duration ends</Text>
            <Text style={styles.value}>{formatTime(end.toISOString())}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setPicking("end")} style={styles.meta}>
            <Text style={styles.label}>Ends</Text>
            <Text style={styles.value}>
              {formatShortDate(end.toISOString())} {allDay ? "" : formatTime(end.toISOString())}
            </Text>
          </Pressable>
        )}
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} anchor={isOccurrence && seriesAnchor ? seriesAnchor : start} />
        {isOccurrence ? (
          <Pressable onPress={() => setScopeOpen(true)} style={styles.meta}>
            <Text style={styles.label}>Scope</Text>
            <Text style={styles.value}>{scopeLabel(scope)}</Text>
          </Pressable>
        ) : null}
        {isOccurrence && seriesOnlyChange && scope !== "all" ? (
          <Text style={styles.hint}>Title, notes, color, project and repeat changes apply to every occurrence, so Save updates the entire series.</Text>
        ) : null}
        <PrimaryButton
          label={save.isPending || editOcc.isPending || split.isPending ? "Saving…" : "Save event"}
          onPress={() => void persist()}
        />
        <Pressable
          onPress={() => setConfirmDelete(true)}
          style={styles.delete}
        >
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete event</Text>
        </Pressable>
      </ScrollView>
      <DateTimeSheet
        open={picking !== null}
        value={picking === "end" ? end : start}
        mode={allDay ? "date" : timeOnly ? "time" : "datetime"}
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (!next) return;
          if (timeOnly) {
            const target = picking === "end" ? end : start;
            const combined = new Date(target);
            combined.setHours(next.getHours(), next.getMinutes(), 0, 0);
            if (picking === "start") {
              const length = end.getTime() - start.getTime();
              setStart(combined);
              setEnd(new Date(combined.getTime() + Math.max(length, 15 * 60_000)));
            } else {
              setEnd(combined);
            }
            return;
          }
          if (picking === "start" && isOccurrence) {
            // Moving one occurrence keeps its length, as the series' time picker does.
            setEnd(new Date(next.getTime() + Math.max(end.getTime() - start.getTime(), 15 * 60_000)));
          }
          if (picking === "start") setStart(next);
          if (picking === "end") setEnd(next);
        }}
      />
      <BottomSheet open={scopeOpen} onClose={() => setScopeOpen(false)} title="Edit scope">
        {scopeOptions.map((value) => (
          <SheetOption
            key={value}
            selected={scope === value}
            onSelect={() => {
              setScope(value);
              setScopeOpen(false);
            }}
          >
            {scopeLabel(value)}
          </SheetOption>
        ))}
      </BottomSheet>
      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete event"
        message={
          !isOccurrence || scope === "all"
            ? "Remove this event?"
            : scope === "this"
              ? "Remove only this occurrence? The rest of the series stays."
              : "Remove this and every following occurrence?"
        }
        onConfirm={removeEvent}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
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
  label: { color: colors.mutedForeground, fontSize: 13 },
  hint: { color: colors.mutedForeground, fontSize: 12, marginLeft: 2 },
  value: { color: colors.foreground, fontSize: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchOn: { borderColor: colors.primary },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
}));
