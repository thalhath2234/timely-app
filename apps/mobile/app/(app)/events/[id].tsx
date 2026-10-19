import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarClock, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import { ColorDot, GroupHint, ListGroup, ListRow, SwitchRow } from "../../../components/settings/SettingsList";
import { RepeatRow } from "../../../components/tasks/TaskMetaRows";
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
  const [sheet, setSheet] = useState<"project" | "colour" | null>(null);
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
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.titleCard}>
          <Field bare large multiline autoGrow value={title} onChangeText={setTitle} placeholder="Event title" autoCapitalize="sentences" />
          <Field bare multiline autoGrow value={description} onChangeText={setDescription} placeholder="Notes, location, links" autoCapitalize="sentences" />
        </View>
        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title={timeOnly ? "Time" : "Starts"}
              trailing={
                timeOnly
                  ? formatTime(start.toISOString())
                  : `${formatShortDate(start.toISOString())}${allDay ? "" : ` ${formatTime(start.toISOString())}`}`
              }
              onPress={() => setPicking("start")}
            />
            <ListRow
              title={timeOnly ? "Ends at" : "Ends"}
              trailing={
                timeOnly
                  ? formatTime(end.toISOString())
                  : `${formatShortDate(end.toISOString())}${allDay ? "" : ` ${formatTime(end.toISOString())}`}`
              }
              onPress={() => setPicking("end")}
            />
            <SwitchRow title="All day" value={allDay} onChange={setAllDay} />
            <RepeatRow
              value={recurrence}
              onChange={setRecurrence}
              anchor={isOccurrence && seriesAnchor ? seriesAnchor : start}
              subtitle={title || undefined}
            />
            {isOccurrence ? <ListRow title="Edits apply to" trailing={scopeLabel(scope)} onPress={() => setScopeOpen(true)} /> : null}
          </ListGroup>
          {isOccurrence && seriesOnlyChange && scope !== "all" ? (
            <GroupHint>Title, notes, colour, project and repeat changes apply to every occurrence, so Save updates the entire series.</GroupHint>
          ) : null}
        </View>
        <ListGroup>
          {scopedProjects.length > 0 ? (
            <ListRow
              title="Project"
              trailing={<RowValue text={scopedProjects.find((project) => project.id === projectId)?.title ?? "None"} dot={scopedProjects.find((project) => project.id === projectId)?.color} />}
              onPress={() => setSheet("project")}
            />
          ) : null}
          <ListRow title="Colour" trailing={<RowValue text={color ? colorName(color) : "Auto"} dot={color || undefined} />} onPress={() => setSheet("colour")} />
        </ListGroup>
        <PrimaryButton
          label={save.isPending || editOcc.isPending || split.isPending ? "Saving…" : "Save event"}
          onPress={() => void persist()}
        />
        <ListGroup>
          <ListRow
            tone="danger"
            leading={<Trash2 size={16} color={colors.destructive} />}
            title="Delete event"
            onPress={() => setConfirmDelete(true)}
          />
        </ListGroup>
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
      <BottomSheet open={sheet === "project"} onClose={() => setSheet(null)} title="Project">
        <SheetOption selected={!projectId} onSelect={() => { setProjectId(""); setSheet(null); }}>
          None
        </SheetOption>
        {scopedProjects.map((project) => (
          <SheetOption
            key={project.id}
            selected={project.id === projectId}
            leading={project.color ? <ColorDot color={project.color} /> : undefined}
            onSelect={() => {
              setProjectId(project.id);
              setSheet(null);
            }}
          >
            {project.title}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={sheet === "colour"} onClose={() => setSheet(null)} title="Colour">
        <SheetOption selected={!color} onSelect={() => { setColor(""); setSheet(null); }}>
          Auto
        </SheetOption>
        {ENTITY_COLORS.map((swatch) => (
          <SheetOption
            key={swatch}
            selected={color === swatch}
            leading={<ColorDot color={swatch} />}
            onSelect={() => {
              setColor(swatch);
              setSheet(null);
            }}
          >
            {colorName(swatch)}
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

function RowValue({ text, dot }: { text: string; dot?: string | null }) {
  return (
    <View style={styles.value}>
      {dot ? <ColorDot color={dot} size={8} /> : null}
      <Text numberOfLines={1} style={styles.valueText}>{text}</Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  titleCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  section: { gap: 6 },
  value: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  valueText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
}));
