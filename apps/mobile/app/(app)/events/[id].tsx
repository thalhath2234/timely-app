import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarClock, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
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
import { ENTITY_COLORS } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const from = startOfDay(addDays(new Date(), -60));
  const to = addDays(new Date(), 120);
  const items = useCalendarQuery(from, to).data?.items ?? [];
  const item = items.find((entry) => entry.eventId === id || entry.event?.id === id);
  const fetched = useEventQuery(id);
  const event = fetched.data ?? item?.event;
  const save = useUpdateEvent();
  const remove = useDeleteEvent();
  const editOcc = useEditEventOccurrence();
  const split = useSplitEventSeries();
  const projects = useProjectsQuery().data ?? [];
  const [title, setTitle] = useState(event?.title ?? item?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [color, setColor] = useState(event?.color ?? "");
  const [projectId, setProjectId] = useState(event?.projectId ?? "");
  const [start, setStart] = useState(event ? new Date(event.start) : item ? new Date(item.start) : new Date());
  const [end, setEnd] = useState(event ? new Date(event.end) : item ? new Date(item.end) : new Date());
  const [allDay, setAllDay] = useState(event?.allDay ?? item?.allDay ?? false);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft | null>(
    event?.recurrence ? rruleToDraft(event.recurrence.rrule, new Date(event.start)) : null,
  );
  const [scope, setScope] = useState<"this" | "future" | "all">("all");
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description);
    setColor(event.color ?? "");
    setProjectId(event.projectId ?? "");
    setStart(new Date(event.start));
    setEnd(new Date(event.end));
    setAllDay(event.allDay);
    setRecurrence(event.recurrence ? rruleToDraft(event.recurrence.rrule, new Date(event.start)) : null);
  }, [event?.id, event?.updatedAt]);

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

  const isOccurrence = item?.kind === "eventOccurrence";
  const scopedProjects = projects.filter(
    (project) => !event?.workspaceId || project.workspaceId === event.workspaceId,
  );

  async function persist() {
    const nextRecurrence = buildRecurrenceInput(recurrence, start);
    const extras = {
      title,
      description,
      color: color || "",
      projectId: projectId || null,
    };
    if (isOccurrence && scope === "this" && item?.originalStart) {
      await editOcc.mutateAsync({
        id,
        originalStart: item.originalStart,
        action: "move",
        newStart: start.toISOString(),
        newEnd: end.toISOString(),
      });
      if (
        title !== event?.title ||
        description !== event?.description ||
        (color || "") !== (event?.color ?? "") ||
        (projectId || null) !== (event?.projectId ?? null)
      ) {
        await save.mutateAsync({ id, data: extras });
      }
      return;
    }
    if (isOccurrence && scope === "future" && item?.originalStart && nextRecurrence) {
      await split.mutateAsync({
        id,
        fromStart: item.originalStart,
        recurrence: nextRecurrence,
        title,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      return;
    }
    save.mutate({
      id,
      data: {
        ...extras,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        recurrence: nextRecurrence,
      },
    });
  }

  return (
    <Screen>
      <MobileHeader title="Event" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Field value={title} onChangeText={setTitle} placeholder="Event title" autoCapitalize="sentences" />
        <Field value={description} onChangeText={setDescription} placeholder="Notes, location, links..." multiline autoCapitalize="sentences" />
        <SectionLabel>Color</SectionLabel>
        <View style={styles.row}>
          <Chip label="Auto" active={!color} onPress={() => setColor("")} />
          {ENTITY_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityLabel={`Color ${swatch}`}
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
          <Text style={styles.label}>{recurrence && !allDay ? "Time" : "Starts"}</Text>
          <Text style={styles.value}>
            {recurrence && !allDay
              ? formatTime(start.toISOString())
              : `${formatShortDate(start.toISOString())}${allDay ? "" : ` ${formatTime(start.toISOString())}`}`}
          </Text>
        </Pressable>
        {recurrence && !allDay ? (
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
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} anchor={start} />
        {isOccurrence ? (
          <Pressable onPress={() => setScopeOpen(true)} style={styles.meta}>
            <Text style={styles.label}>Scope</Text>
            <Text style={styles.value}>
              {scope === "this" ? "This occurrence" : scope === "future" ? "This and future" : "Entire series"}
            </Text>
          </Pressable>
        ) : null}
        <PrimaryButton
          label={save.isPending || editOcc.isPending || split.isPending ? "Saving…" : "Save event"}
          onPress={() => void persist()}
        />
        <Pressable
          onPress={() =>
            Alert.alert("Delete event", "Remove this event?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => remove.mutate(id, { onSuccess: () => router.replace("/(app)/(tabs)/calendar") }),
              },
            ])
          }
          style={styles.delete}
        >
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete event</Text>
        </Pressable>
      </ScrollView>
      <DateTimeSheet
        open={picking !== null}
        value={picking === "end" ? end : start}
        mode={allDay ? "date" : recurrence && !allDay ? "time" : "datetime"}
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (!next) return;
          if (recurrence && !allDay) {
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
          if (picking === "start") setStart(next);
          if (picking === "end") setEnd(next);
        }}
      />
      <BottomSheet open={scopeOpen} onClose={() => setScopeOpen(false)} title="Edit scope">
        {(["this", "future", "all"] as const).map((value) => (
          <SheetOption
            key={value}
            selected={scope === value}
            onSelect={() => {
              setScope(value);
              setScopeOpen(false);
            }}
          >
            {value === "this" ? "This occurrence" : value === "future" ? "This and future" : "Entire series"}
          </SheetOption>
        ))}
      </BottomSheet>
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
