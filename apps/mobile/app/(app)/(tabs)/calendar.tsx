import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import DateStrip from "../../../components/calendar/DateStrip";
import MobileAgenda from "../../../components/calendar/MobileAgenda";
import MobileDay from "../../../components/calendar/MobileDay";
import MobileMonth from "../../../components/calendar/MobileMonth";
import CalendarItemSheet from "../../../components/calendar/CalendarItemSheet";
import AutoScheduleSheet from "../../../components/calendar/AutoScheduleSheet";
import { useCalendarQuery, useMoveBlock, useMoveEventTimes, useSaveTask } from "../../../lib/hooks";
import { mergeCalendarItems } from "../../../lib/calendarMerge";
import { addDays, dayKey, formatMonthYear, isSameDay, startOfDay } from "../../../lib/format";
import type { CalendarItem } from "../../../lib/types";
import { colors } from "../../../lib/theme";

type CalView = "day" | "agenda" | "month";

export default function CalendarScreen() {
  const [view, setView] = useState<CalView>("agenda");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);

  const { from, to } = useMemo(() => {
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(gridStart, 42);
    const agendaEnd = addDays(selected, 21);
    return {
      from: gridStart < addDays(selected, -7) ? gridStart : addDays(selected, -7),
      to: gridEnd > agendaEnd ? gridEnd : agendaEnd,
    };
  }, [selected]);

  const query = useCalendarQuery(from, to);
  const items = mergeCalendarItems(query.data?.items ?? []);
  const save = useSaveTask();
  const moveBlk = useMoveBlock();
  const moveEvt = useMoveEventTimes();

  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(dayKey(startOfDay(new Date(item.start))));
    return set;
  }, [items]);

  const dayItems = useMemo(
    () => items.filter((i) => isSameDay(new Date(i.start), selected)),
    [items, selected],
  );

  function reschedule(item: CalendarItem, start: Date) {
    const duration = new Date(item.end).getTime() - new Date(item.start).getTime();
    if (item.kind === "task" && item.blockId) {
      void moveBlk.mutateAsync({ id: item.blockId, start: start.toISOString(), end: new Date(start.getTime() + duration).toISOString() });
    } else if ((item.kind === "event" || item.kind === "eventOccurrence") && item.eventId) {
      void moveEvt.mutateAsync({
        id: item.eventId,
        start: start.toISOString(),
        end: new Date(start.getTime() + duration).toISOString(),
      });
    }
  }

  function toggleComplete(item: CalendarItem) {
    if (!item.taskId) return;
    save.mutate({
      id: item.taskId,
      data: { completedAt: item.completedAt ? null : new Date().toISOString() },
    });
    setOpen(null);
  }

  function step(dir: -1 | 1) {
    if (view === "month") setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir, 1));
    else setSelected(addDays(selected, dir * (view === "day" ? 1 : 7)));
  }

  const isToday = isSameDay(selected, new Date());

  return (
    <Screen>
      <MobileHeader
        title={formatMonthYear(selected)}
        actions={
          <>
            <HeaderIconButton label="Auto-schedule" onPress={() => setAutoOpen(true)}>
              <Sparkles size={18} color={colors.foreground} />
            </HeaderIconButton>
            <HeaderIconButton label="Previous" onPress={() => step(-1)}>
              <ChevronLeft size={22} color={colors.foreground} />
            </HeaderIconButton>
            <HeaderIconButton label="Next" onPress={() => step(1)}>
              <ChevronRight size={22} color={colors.foreground} />
            </HeaderIconButton>
            <Pressable onPress={() => setSelected(startOfDay(new Date()))} disabled={isToday} style={[styles.today, isToday && { opacity: 0.4 }]}>
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          </>
        }
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <SegmentedControl
            options={[
              { label: "Day", value: "day" },
              { label: "Agenda", value: "agenda" },
              { label: "Month", value: "month" },
            ]}
            value={view}
            onChange={setView}
          />
        </View>
        {view !== "month" ? <DateStrip selected={selected} onSelect={setSelected} busyDays={busyDays} /> : null}
      </MobileHeader>
      <View style={{ flex: 1, minHeight: 0 }}>
        {view === "agenda" ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <MobileAgenda items={items} from={selected} onOpen={setOpen} />
          </ScrollView>
        ) : null}
        {view === "day" ? <MobileDay date={selected} items={dayItems} onOpen={setOpen} /> : null}
        {view === "month" ? (
          <MobileMonth month={selected} selected={selected} onSelect={setSelected} items={items} onOpen={setOpen} />
        ) : null}
      </View>
      <CalendarItemSheet item={open} onClose={() => setOpen(null)} onToggleComplete={toggleComplete} onReschedule={reschedule} />
      <AutoScheduleSheet open={autoOpen} onClose={() => setAutoOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  today: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  todayText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
});
