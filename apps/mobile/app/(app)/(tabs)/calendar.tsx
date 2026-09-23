import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import DateStrip from "../../../components/calendar/DateStrip";
import MobileAgenda from "../../../components/calendar/MobileAgenda";
import MobileDay from "../../../components/calendar/MobileDay";
import MobileMonth from "../../../components/calendar/MobileMonth";
import MobileWeek from "../../../components/calendar/MobileWeek";
import CalendarItemSheet from "../../../components/calendar/CalendarItemSheet";
import AutoScheduleSheet from "../../../components/calendar/AutoScheduleSheet";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import {
  useAddBlock,
  useCalendarQuery,
  useEditTaskOccurrence,
  useMoveBlock,
  useMoveEventTimes,
  useProjectsQuery,
  useSaveTask,
  useTasksQuery,
  useWorkingHoursQuery,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { isReminderItem, matchesCalendarScope } from "../../../components/calendar/CalendarItemRow";
import { Select } from "../../../components/ui/primitives";
import { mergeCalendarItems } from "../../../lib/calendarMerge";
import { overdueAgendaTasks, taskToCalendarItem } from "../../../lib/overdue";
import { rankUnscheduled } from "../../../lib/scheduleRank";
import { calendarBusy, findNextFreeSlot, type BusyInterval } from "../../../lib/nextFreeSlot";
import { requestQuickAdd } from "../../../lib/quickAddIntent";
import { addDays, dayKey, formatDuration, formatMonthYear, formatTime, isSameDay, startOfDay } from "../../../lib/format";
import { taskDeadlineDate } from "../../../lib/taskDates";
import type { CalendarItem, Task } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { needsNetworkCopy } from "../../../lib/queryCopy";

type CalView = "day" | "week" | "agenda" | "month";

function nextQuarterOn(day: Date) {
  const now = new Date();
  const next = new Date(day);
  const minutes = Math.ceil((now.getMinutes() + 1) / 15) * 15;
  next.setHours(now.getHours(), minutes, 0, 0);
  return next;
}

function calendarWindow(anchor: Date) {
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1),
  };
}

export default function CalendarScreen() {
  const router = useRouter();
  const [view, setView] = useState<CalView>("agenda");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [slot, setSlot] = useState<Date | null>(null);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);
  const [heldSlots, setHeldSlots] = useState<BusyInterval[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const monthKey = `${selected.getFullYear()}-${selected.getMonth()}`;
  const { from, to } = useMemo(() => calendarWindow(selected), [monthKey]);

  const query = useCalendarQuery(from, to);
  const networkCopy = needsNetworkCopy(query);
  const workspaces = useWorkspacesQuery().data ?? [];
  const projects = useProjectsQuery().data ?? [];
  const scopedProjects = useMemo(
    () => projects.filter((project) => (workspaceId ? project.workspaceId === workspaceId : true)),
    [projects, workspaceId],
  );
  const occupancy = useMemo(
    () => mergeCalendarItems(query.data?.items ?? []),
    [query.data?.items],
  );
  const items = useMemo(
    () => occupancy.filter((item) => matchesCalendarScope(item, workspaceId, projectId)),
    [occupancy, workspaceId, projectId],
  );
  const tasks = useTasksQuery().data ?? [];
  const hoursQ = useWorkingHoursQuery();
  const overdue = useMemo(
    () =>
      overdueAgendaTasks(tasks)
        .map(taskToCalendarItem)
        .filter((item) => matchesCalendarScope(item, workspaceId, projectId)),
    [tasks, workspaceId, projectId],
  );
  const waiting = useMemo(
    () =>
      rankUnscheduled(tasks)
        .filter((task) => {
          if (workspaceId && (task.workspace?.id || task.workspaceId) !== workspaceId) return false;
          if (projectId && (task.project?.id || task.projectId) !== projectId) return false;
          return true;
        })
        .slice(0, 8),
    [tasks, workspaceId, projectId],
  );
  const nextSlot = useMemo(
    () =>
      findNextFreeSlot({
        durationMinutes: scheduleTask?.duration || 30,
        hours: hoursQ.data,
        busy: [...calendarBusy(occupancy), ...heldSlots],
      }),
    [hoursQ.data, occupancy, heldSlots, scheduleTask?.duration],
  );
  const save = useSaveTask();
  const moveBlk = useMoveBlock();
  const moveEvt = useMoveEventTimes();
  const editOccurrence = useEditTaskOccurrence();
  const addBlock = useAddBlock();

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
    const end = isReminderItem(item) ? start : new Date(start.getTime() + Math.max(duration, 0));
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
        data: { completedAt: item.completedAt ? "" : new Date().toISOString() },
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
            <AnimatedPressable onPress={() => setSelected(startOfDay(new Date()))} disabled={isToday} style={[styles.today, isToday && { opacity: 0.4 }]}>
              <Text style={styles.todayText}>Today</Text>
            </AnimatedPressable>
          </>
        }
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}>
          <SegmentedControl
            options={[
              { label: "Day", value: "day" },
              { label: "Week", value: "week" },
              { label: "Agenda", value: "agenda" },
              { label: "Month", value: "month" },
            ]}
            value={view}
            onChange={setView}
          />
          {workspaces.length > 0 || scopedProjects.length > 0 ? (
            <View style={styles.filters}>
              {workspaces.length > 0 ? (
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Select
                    value={workspaceId ?? ""}
                    onChange={(id) => {
                      setWorkspaceId(id || null);
                      if (projectId && !projects.some((project) => project.id === projectId && (!id || project.workspaceId === id))) {
                        setProjectId(null);
                      }
                    }}
                    placeholder="All spaces"
                    options={[
                      { value: "", label: "All spaces" },
                      ...workspaces.map((space) => ({ value: space.id, label: space.name, color: space.color ?? undefined })),
                    ]}
                  />
                </View>
              ) : null}
              {scopedProjects.length > 0 ? (
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Select
                    value={projectId ?? ""}
                    onChange={(id) => setProjectId(id || null)}
                    placeholder="All projects"
                    options={[
                      { value: "", label: "All projects" },
                      ...scopedProjects.map((project) => ({
                        value: project.id,
                        label: project.title || "Untitled project",
                        color: project.color ?? undefined,
                      })),
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {view !== "month" ? <DateStrip selected={selected} onSelect={setSelected} busyDays={busyDays} /> : null}
      </MobileHeader>
      <View style={{ flex: 1, minHeight: 0 }}>
        {networkCopy ? (
          <EmptyState icon={Sparkles} title="Couldn't load calendar" description={networkCopy} />
        ) : (
          <>
            {waiting.length > 0 ? (
              <View style={styles.waiting}>
                <AnimatedPressable onPress={() => setWaitingOpen((open) => !open)} style={styles.waitingHead}>
                  <Text style={styles.waitingTitle}>Waiting for a slot</Text>
                  <Text style={styles.waitingCount}>{waiting.length}</Text>
                </AnimatedPressable>
                {waitingOpen
                  ? waiting.map((task) => {
                      const due = taskDeadlineDate(task);
                      return (
                        <View key={task.id} style={styles.waitingRow}>
                          <AnimatedPressable onPress={() => router.push(`/(app)/tasks/${task.id}`)} style={{ flex: 1 }}>
                            <Text style={[styles.waitingName, task.completedAt ? styles.waitingDone : null]}>{task.name}</Text>
                            <Text style={styles.waitingMeta}>
                              {formatDuration(task.duration) ?? "No estimate"}
                              {due ? ` · due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                              {task.blockedById ? " · waiting on another task" : ""}
                            </Text>
                          </AnimatedPressable>
                          <AnimatedPressable onPress={() => setScheduleTask(task)}>
                            <Text style={styles.waitingAction}>Schedule</Text>
                          </AnimatedPressable>
                        </View>
                      );
                    })
                  : null}
              </View>
            ) : null}
            {view === "agenda" ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 110 }}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                  <RefreshControl
                    refreshing={query.isRefetching && !query.isPending}
                    onRefresh={() => void query.refetch()}
                    tintColor={colors.primary}
                  />
                }
              >
                <MobileAgenda items={items} from={selected} overdue={overdue} onOpen={setOpen} />
              </ScrollView>
            ) : view === "day" ? (
              <MobileDay date={selected} items={dayItems} onOpen={setOpen} onEmptySlot={setSlot} />
            ) : view === "week" ? (
              <MobileWeek
                selected={selected}
                items={items}
                onSelect={setSelected}
                onOpen={setOpen}
                onEmptyDay={(day) => setSlot(nextQuarterOn(day))}
              />
            ) : (
              <MobileMonth month={selected} selected={selected} onSelect={setSelected} items={items} onOpen={setOpen} />
            )}
          </>
        )}
      </View>
      <CalendarItemSheet item={open} onClose={() => setOpen(null)} onToggleComplete={toggleComplete} onReschedule={reschedule} />
      <AutoScheduleSheet open={autoOpen} onClose={() => setAutoOpen(false)} />
      <BottomSheet open={Boolean(slot)} onClose={() => setSlot(null)} title={slot ? `New at ${formatTime(slot.toISOString())}` : "New"}>
        <SheetOption
          onSelect={() => {
            if (slot) requestQuickAdd({ kind: "task", start: slot });
            setSlot(null);
          }}
        >
          Task
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (slot) requestQuickAdd({ kind: "event", start: slot });
            setSlot(null);
          }}
        >
          Event
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (slot) requestQuickAdd({ kind: "reminder", start: slot });
            setSlot(null);
          }}
        >
          Reminder
        </SheetOption>
      </BottomSheet>
      <DateTimeSheet
        key={scheduleTask?.id ?? "closed"}
        open={Boolean(scheduleTask)}
        value={nextSlot}
        title={scheduleTask ? `Schedule ${scheduleTask.name}` : "Schedule"}
        onClose={() => setScheduleTask(null)}
        onChange={(start) => {
          if (!scheduleTask || !start) {
            setScheduleTask(null);
            return;
          }
          const duration = scheduleTask.duration || 30;
          const end = new Date(start.getTime() + duration * 60_000);
          const interval = { start: start.toISOString(), end: end.toISOString() };
          setHeldSlots((current) => [...current, interval]);
          void addBlock
            .mutateAsync({
              taskId: scheduleTask.id,
              data: { start: start.toISOString(), durationMinutes: duration },
            })
            .catch((error: unknown) => {
              setHeldSlots((current) =>
                current.filter((item) => item.start !== interval.start || item.end !== interval.end),
              );
              Alert.alert("Could not schedule", error instanceof Error ? error.message : "Try again.");
            });
          setScheduleTask(null);
        }}
      />
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
  waiting: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
  waitingHead: { flexDirection: "row", alignItems: "center" },
  waitingTitle: { flex: 1, color: colors.foreground, fontWeight: "600" },
  waitingCount: { color: colors.primary, fontSize: 11, fontWeight: "700", borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 7, paddingVertical: 3 },
  waitingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  waitingName: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  waitingDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  waitingMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  waitingAction: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  filters: { flexDirection: "row", gap: 8 },
}));
