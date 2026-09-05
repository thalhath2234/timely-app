import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import { Chip, Field, PrimaryButton } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import { useCalendarQuery, useDeleteEvent, useUpdateEvent } from "../../../lib/hooks";
import { addDays, formatShortDate, formatTime, startOfDay } from "../../../lib/format";
import { deviceTimezone } from "../../../lib/format";
import { CalendarClock } from "lucide-react-native";
import { colors } from "../../../lib/theme";

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const from = startOfDay(addDays(new Date(), -60));
  const to = addDays(new Date(), 120);
  const items = useCalendarQuery(from, to).data?.items ?? [];
  const item = items.find((i) => i.eventId === id || i.event?.id === id);
  const event = item?.event;
  const save = useUpdateEvent();
  const remove = useDeleteEvent();
  const [title, setTitle] = useState(event?.title ?? item?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [start, setStart] = useState(event ? new Date(event.start) : item ? new Date(item.start) : new Date());
  const [end, setEnd] = useState(event ? new Date(event.end) : item ? new Date(item.end) : new Date());
  const [allDay, setAllDay] = useState(event?.allDay ?? item?.allDay ?? false);
  const [freq, setFreq] = useState<"none" | "daily" | "weekly">("none");
  const [scope, setScope] = useState<"this" | "future" | "all">("all");
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);

  useMemo(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description);
      setStart(new Date(event.start));
      setEnd(new Date(event.end));
      setAllDay(event.allDay);
      if (event.recurrence?.rrule.includes("WEEKLY")) setFreq("weekly");
      else if (event.recurrence?.rrule.includes("DAILY")) setFreq("daily");
    }
  }, [event?.id]);

  if (!item && !event) {
    return (
      <Screen>
        <MobileHeader title="Event" back large={false} />
        <EmptyState icon={CalendarClock} title="Event not found" description="It may have been deleted." />
      </Screen>
    );
  }

  function persist() {
    const recurrence =
      freq === "none"
        ? null
        : {
            rrule: freq === "weekly" ? "FREQ=WEEKLY" : "FREQ=DAILY",
            dtstart: start.toISOString(),
            timezone: deviceTimezone(),
          };
    save.mutate({
      id,
      data: {
        title,
        description,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        recurrence,
      },
    });
  }

  return (
    <Screen>
      <MobileHeader title="Event" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Field value={title} onChangeText={setTitle} placeholder="Event title" autoCapitalize="sentences" />
        <Field value={description} onChangeText={setDescription} placeholder="Description" multiline autoCapitalize="sentences" />
        <Chip label={allDay ? "All day on" : "All day off"} active={allDay} onPress={() => setAllDay((v) => !v)} />
        <Pressable onPress={() => setPicking("start")} style={styles.meta}>
          <Text style={styles.label}>Starts</Text>
          <Text style={styles.value}>
            {formatShortDate(start.toISOString())} {allDay ? "" : formatTime(start.toISOString())}
          </Text>
        </Pressable>
        <Pressable onPress={() => setPicking("end")} style={styles.meta}>
          <Text style={styles.label}>Ends</Text>
          <Text style={styles.value}>
            {formatShortDate(end.toISOString())} {allDay ? "" : formatTime(end.toISOString())}
          </Text>
        </Pressable>
        <Text style={styles.section}>Repeats</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["none", "daily", "weekly"] as const).map((f) => (
            <Chip key={f} label={f} active={freq === f} onPress={() => setFreq(f)} />
          ))}
        </View>
        {item?.kind === "eventOccurrence" ? (
          <Pressable onPress={() => setScopeOpen(true)} style={styles.meta}>
            <Text style={styles.label}>Scope</Text>
            <Text style={styles.value}>{scope}</Text>
          </Pressable>
        ) : null}
        <PrimaryButton label={save.isPending ? "Saving…" : "Save event"} onPress={persist} />
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
        mode={allDay ? "date" : "datetime"}
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (!next) return;
          if (picking === "start") setStart(next);
          if (picking === "end") setEnd(next);
        }}
      />
      <BottomSheet open={scopeOpen} onClose={() => setScopeOpen(false)} title="Edit scope">
        {(["this", "future", "all"] as const).map((s) => (
          <SheetOption key={s} selected={scope === s} onSelect={() => { setScope(s); setScopeOpen(false); }}>
            {s === "this" ? "This occurrence" : s === "future" ? "This and future" : "Entire series"}
          </SheetOption>
        ))}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
});
