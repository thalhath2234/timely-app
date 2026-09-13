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
import EmptyState from "../../../components/ui/EmptyState";
import { useCalendarQuery, useEditTaskOccurrence, useMoveBlock, useMoveEventTimes, useSaveTask, useTasksQuery } from "../../../lib/hooks";
import { isReminderItem } from "../../../components/calendar/CalendarItemRow";
import { mergeCalendarItems } from "../../../lib/calendarMerge";
import { overdueAgendaTasks, taskToCalendarItem } from "../../../lib/overdue";
import { addDays, dayKey, formatMonthYear, isSameDay, startOfDay } from "../../../lib/format";
import type { CalendarItem } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

type CalView = "day" | "agenda" | "month";

export default function CalendarScreen() {
  const [view, setView] = useState<CalView>("agenda");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);

  const { from, to } = useMemo(() => {
    const day = startOfDay(selected);
    return {
      from: addDays(day, -45),
      to: addDays(day, 45),
    };
  }, [selected]);

  const query = useCalendarQuery(from, to);
  const items = mergeCalendarItems(query.data?.items ?? []);
  const tasks = useTasksQuery().data ?? [];
  const overdue = useMemo(
    () => overdueAgendaTasks(tasks).map(taskToCalendarItem),
    [tasks],
  );
  const save = useSaveTask();
  const moveBlk = useMoveBlock();
  const moveEvt = useMoveEventTimes();
  const editOccurrence = useEditTaskOccurrence();

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
    const end = isReminderItem(item)
      ? start
      : new Date(start.getTime() + Math.max(duration, 0));
    if (item.kind === "task" && isReminderItem(item) && item.taskId) {
      void save.mutateAsync({ id: item.taskId, data: { scheduledOn: start.toISOString() } });
    } else if (item.kind === "taskOccurrence" && item.taskId && item.originalStart) {
      void editOccurrence.mutateAsync({
        id: item.taskId,
        originalStart: item.originalStart,
        action: "move",
        newStart: start.toISOString(),
        newEnd: end.toISOString(),
      });
    } else if (item.kind === "task" && item.blockId) {
      void moveBlk.mutateAsync({ id: item.blockId, start: start.toISOString(), end: end.toISOString() });
    } else if ((item.kind === "event" || item.kind === "eventOccurrence") && item.eventId) {
      void moveEvt.mutateAsync({
        id: item.eventId,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }

  function toggleComplete(item: CalendarItem) {
    if (!item.taskId) return;
    if (item.kind === "taskOccurrence" && item.originalStart) {
      void editOccurrence.mutateAsync({
        id: item.taskId,
        originalStart: item.originalStart,
        action: item.completedAt ? "uncomplete" : "complete",
      });
    } else {
      save.mutate({
        id: item.taskId,
        data: { completedAt: item.completedAt ? null : new Date().toISOString() },
      });
    }
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
        {query.isError ? (
          <EmptyState
            icon={Sparkles}
            title="Couldn't load calendar"
            description="Check your connection and try again."
          />
        ) : view === "agenda" ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <MobileAgenda items={items} from={selected} overdue={overdue} onOpen={setOpen} />
          </ScrollView>
        ) : view === "day" ? (
          <MobileDay date={selected} items={dayItems} onOpen={setOpen} />
        ) : (
          <MobileMonth month={selected} selected={selected} onSelect={setSelected} items={items} onOpen={setOpen} />
        )}
      </View>
      <CalendarItemSheet item={open} onClose={() => setOpen(null)} onToggleComplete={toggleComplete} onReschedule={reschedule} />
      <AutoScheduleSheet open={autoOpen} onClose={() => setAutoOpen(false)} />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  today: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  todayText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
}));
