import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { startOfWeek } from "../../../lib/format";
import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import DateStrip from "../../../components/calendar/DateStrip";
import CalendarScopeSelect from "../../../components/calendar/CalendarScopeSelect";
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
  useFreeTimeQuery,
  useMoveBlock,
  useMoveEventTimes,
  useProjectsQuery,
  useRankQuery,
  useSaveTask,
  useTasksQuery,
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { isReminderItem, matchesCalendarScope } from "../../../components/calendar/CalendarItemRow";
import { overdueAgendaTasks, taskToCalendarItem } from "../../../lib/overdue";
import { findNextFreeSlot } from "../../../lib/nextFreeSlot";
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

function toCalendarEnd(anchor: Date) { return new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1); }

function calendarWindow(anchor: Date) {
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1),
  };
}

const EMPTY_ITEMS: CalendarItem[] = [];

export default function CalendarScreen() {
  const router = useRouter();
  const [view, setView] = useState<CalView>("agenda");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [slot, setSlot] = useState<Date | null>(null);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const visibleFrom = view === "month" ? new Date(selected.getFullYear(), selected.getMonth(), 1) : view === "week" ? startOfWeek(selected) : selected;
  const visibleTo = view === "month" ? new Date(selected.getFullYear(), selected.getMonth() + 1, 1) : addDays(visibleFrom, view === "day" ? 1 : view === "week" ? 7 : Math.ceil((toCalendarEnd(selected).getTime() - visibleFrom.getTime()) / 86400000));
  useAssistantScreen([
    contextChip("calendar", `${view} · ${dayKey(selected)}`, { view, selectedDate: dayKey(selected), from: dayKey(visibleFrom), toExclusive: dayKey(visibleTo) }),
    ...(workspaceId ? [contextChip("workspace", "Workspace", workspaceId)] : []),
    ...(projectId ? [contextChip("project", "Project", projectId)] : []),
    ...(open ? [contextChip("object", open.title, `${open.kind === "event" ? "events" : "tasks"}/${open.eventId || open.taskId || open.id}`)] : []),
  ]);

  const monthKey = `${selected.getFullYear()}-${selected.getMonth()}`;
  const { from, to } = useMemo(() => calendarWindow(selected), [monthKey]);

  const query = useCalendarQuery(from, to);
  const rankQ = useRankQuery();
  const networkCopy = needsNetworkCopy(query);
  const workspaces = useWorkspacesQuery().data ?? [];
  const projects = useProjectsQuery().data ?? [];
  const scopedProjects = useMemo(
    () => projects.filter((project) => (workspaceId ? project.workspaceId === workspaceId : true)),
    [projects, workspaceId],
  );
  // The Range endpoint's Calendar items are the grid (ADR 0006): one bar per
  // Block, drawn as returned.
  const occupancy = query.data?.items ?? EMPTY_ITEMS;
  const items = useMemo(
    () => occupancy.filter((item) => matchesCalendarScope(item, workspaceId, projectId)),
    [occupancy, workspaceId, projectId],
  );
  const tasks = useTasksQuery().data ?? [];
  const workspaceOptions = useMemo(() => workspaces.map((space) => ({ id: space.id, title: space.name, color: space.color, count: projects.filter((project) => project.workspaceId === space.id).length })), [workspaces, projects]);
  const projectOptions = useMemo(() => scopedProjects.map((project) => ({ id: project.id, title: project.title || "Untitled project", color: project.color, count: tasks.filter((task) => task.projectId === project.id && !task.completedAt).length })), [scopedProjects, tasks]);
  const workingHoursZone = useWorkingHoursZone();
  const overdue = useMemo(
    () =>
      overdueAgendaTasks(tasks, workingHoursZone)
        .map(taskToCalendarItem)
        .filter((item) => matchesCalendarScope(item, workspaceId, projectId)),
    [tasks, workingHoursZone, workspaceId, projectId],
  );
  const waiting = useMemo(
    () =>
      (rankQ.data ?? [])
        .map((row) => row.task)
        .filter((task) => {
          if (workspaceId && (task.workspace?.id || task.workspaceId) !== workspaceId) return false;
          if (projectId && (task.project?.id || task.projectId) !== projectId) return false;
          return true;
        })
        .slice(0, 8),
    [rankQ.data, workspaceId, projectId],
  );
  // The server takes Events and Blocks out of Working hours; the sheet picks
  // the first gap that fits. The window is fixed when the sheet opens so its
  // query key stays put while it is open.
  const freeWindow = useMemo(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return { from: now, to: addDays(now, 21) };
  }, [scheduleTask?.id]);
  const freeTime = useFreeTimeQuery(freeWindow.from, freeWindow.to, Boolean(scheduleTask));
  const nextSlot = useMemo(
    () => findNextFreeSlot({ durationMinutes: scheduleTask?.duration || 30, slots: freeTime.data ?? [] }),
    [freeTime.data, scheduleTask?.duration],
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
        large={false}
        actions={
          <View style={styles.dateNavActions}>
            <AnimatedPressable accessibilityLabel="Previous period" onPress={() => step(-1)} style={styles.navButton}>
              <ChevronLeft size={20} color={colors.foreground} />
            </AnimatedPressable>
            <AnimatedPressable onPress={() => setSelected(startOfDay(new Date()))} disabled={isToday} style={[styles.today, isToday && styles.todayDisabled]}>
              <Text style={styles.todayText}>Today</Text>
            </AnimatedPressable>
            <AnimatedPressable accessibilityLabel="Next period" onPress={() => step(1)} style={styles.navButton}>
              <ChevronRight size={20} color={colors.foreground} />
            </AnimatedPressable>
            <HeaderIconButton label="Auto-schedule" onPress={() => setAutoOpen(true)}>
              <Sparkles size={18} color={colors.primary} />
            </HeaderIconButton>
          </View>
        }
      >
        <View style={styles.headerControls}>
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
                  <CalendarScopeSelect
                    kind="spaces"
                    value={workspaceId}
                    options={workspaceOptions}
                    onChange={(id) => {
                      setWorkspaceId(id);
                      if (projectId && !projects.some((project) => project.id === projectId && (!id || project.workspaceId === id))) {
                        setProjectId(null);
                      }
                    }}
                    onCreate={() => router.push("/(app)/settings/workspaces")}
                  />
                </View>
              ) : null}
              {scopedProjects.length > 0 ? (
                <View style={{ flex: 1, minWidth: 0 }}>
                  <CalendarScopeSelect
                    kind="projects"
                    value={projectId}
                    onChange={setProjectId}
                    options={projectOptions}
                    onCreate={() => router.push("/(app)/projects")}
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
          void addBlock
            .mutateAsync({
              taskId: scheduleTask.id,
              data: { start: start.toISOString(), durationMinutes: duration },
            })
            .catch((error: unknown) => {
              Alert.alert("Could not schedule", error instanceof Error ? error.message : "Try again.");
            });
          setScheduleTask(null);
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  headerControls: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  dateNavActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  navButton: { width: 36, height: 36, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  today: {
    height: 36,
    borderRadius: 14,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  todayDisabled: { opacity: 0.5 },
  todayText: { color: colors.accentForeground, fontSize: 13, fontWeight: "700" },
  waiting: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 20,
    backgroundColor: colors.muted,
    padding: 16,
    gap: 8,
  },
  waitingHead: { flexDirection: "row", alignItems: "center" },
  waitingTitle: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "700" },
  waitingCount: { color: colors.primary, fontSize: 11, fontWeight: "700", borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 7, paddingVertical: 3 },
  waitingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  waitingName: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  waitingDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  waitingMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  waitingAction: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  filters: { flexDirection: "row", gap: 8 },
}));
