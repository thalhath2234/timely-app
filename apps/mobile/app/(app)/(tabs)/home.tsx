import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Check,
  ChevronRight,
  Inbox,
  Moon,
  Pause,
  Play,
  Plus,
  Star,
  Sun,
  Video,
} from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet from "../../../components/ui/BottomSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import {
  useSaveTask,
  useSetTodayFocus,
  useStartFocus,
  usePauseFocus,
  useTasksQuery,
  useTodayQuery,
} from "../../../lib/hooks";
import { addCalendarDays } from "../../../lib/format";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { showUndoToast } from "../../../lib/toast";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import type { CalendarItem, Task } from "../../../lib/types";
import { taskEntityColor } from "../../../lib/entityColor";

const MAX_TODAY_FOCUS = 7;
const MEETING_URL = /https?:\/\/[^\s]+(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)[^\s]*/i;

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function meetingUrl(item: CalendarItem) {
  const text = [item.event?.description, item.task?.description].filter(Boolean).join("\n");
  return text.match(MEETING_URL)?.[0] ?? null;
}

function TaskRow({
  title,
  meta,
  onPress,
  accent,
  active,
  danger,
  done,
  timeline,
  onComplete,
  children,
}: {
  title: string;
  meta?: string | null;
  onPress: () => void;
  accent?: string;
  active?: boolean;
  danger?: boolean;
  done?: boolean;
  timeline?: boolean;
  onComplete?: () => void;
  children?: ReactNode;
}) {
  return (
    <AnimatedPressable onPress={onPress} style={[styles.row, timeline && styles.timelineCard, active && styles.rowActive, danger && styles.rowDanger, done && styles.rowDone]}>
      <View style={[styles.rowRail, { backgroundColor: accent ?? colors.mutedForeground }]} pointerEvents="none" />
      {onComplete ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(done) }}
          accessibilityLabel={`Complete ${title}`}
          onPress={onComplete}
          hitSlop={8}
          style={[styles.checkRing, danger && styles.checkRingDanger, active && styles.checkRingActive, done && styles.checkRingDone]}
        >
          {done ? <Check size={12} color="#fff" /> : null}
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[styles.title, done && styles.titleDone]}>{title}</Text>
        {meta ? <Text style={[styles.meta, active && styles.metaActive, danger && styles.metaDanger, done && styles.titleDone]}>{meta}</Text> : null}
      </View>
      {children}
    </AnimatedPressable>
  );
}

function overdueLabel(deadline?: string | null) {
  if (!deadline) return "Overdue";
  const due = new Date(deadline);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((today.getTime() - due.getTime()) / 86_400_000));
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const today = useTodayQuery();
  const tasks = useTasksQuery();
  const startFocus = useStartFocus();
  const pauseFocus = usePauseFocus();
  const setFocus = useSetTodayFocus();
  const save = useSaveTask();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const data = today.data;
  const focusingId = data?.focusing?.id;
  const focusSession = data?.focusing ?? data?.pausedFocus;
  const isPaused = !data?.focusing && Boolean(data?.pausedFocus);
  const networkCopy = needsNetworkCopy(today);

  useEffect(() => {
    if (!focusingId) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [focusingId]);

  const elapsed = data?.focusing?.focusStartedAt
    ? (data.focusing.actualMinutes ?? 0) * 60 + Math.max(0, Math.floor((now - new Date(data.focusing.focusStartedAt).getTime()) / 1000))
    : (data?.pausedFocus?.actualMinutes ?? 0) * 60;

  const scheduled = useMemo(() => data?.items ?? [], [data?.items]);
  const focusCount = data?.todayFocus.length ?? 0;
  const completedFocusCount = data?.todayFocus.filter((task) => task.completedAt).length ?? 0;
  const remainingSlots = Math.max(0, MAX_TODAY_FOCUS - focusCount);

  const pickerCandidates = useMemo(() => {
    const starred = new Set((data?.todayFocus ?? []).map((task) => task.id));
    return (tasks.data ?? []).filter((task) => {
      if (starred.has(task.id) || task.completedAt) return false;
      return task.kind !== "reminder";
    });
  }, [data?.todayFocus, tasks.data]);
  const pickerGroups = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of pickerCandidates) {
      const title = task.kind === "inbox" ? "Recent Captures & Quick Add" : task.project?.title || task.workspace?.name || "Other work";
      const group = groups.get(title) ?? [];
      group.push(task);
      groups.set(title, group);
    }
    return [...groups.entries()];
  }, [pickerCandidates]);

  function openPicker() {
    setPickerSelected([]);
    setPickerOpen(true);
  }

  function togglePicker(id: string) {
    setPickerSelected((selected) => selected.includes(id)
      ? selected.filter((item) => item !== id)
      : selected.length < remainingSlots ? [...selected, id] : selected);
  }

  async function addSelectedToToday() {
    if (!data || pickerSelected.length === 0) return;
    const results = await Promise.allSettled(pickerSelected.map((id) => setFocus.mutateAsync({ id, date: data.date })));
    const failed = results.filter((result) => result.status === "rejected").length;
    setPickerSelected([]);
    setPickerOpen(false);
    if (failed) Alert.alert("Could not add every task", `${failed} ${failed === 1 ? "task" : "tasks"} could not be added. Please try again.`);
  }

  function openTask(id: string) {
    router.push(`/(app)/tasks/${id}`);
  }

  function openItem(item: CalendarItem) {
    if (item.taskId) {
      openTask(item.taskId);
      return;
    }
    if (item.eventId) router.push(`/(app)/events/${item.eventId}`);
  }

  function completeTask(task: Task) {
    const previous = task.completedAt ?? "";
    const next = task.completedAt ? "" : new Date().toISOString();
    void save.mutateAsync({ id: task.id, data: { completedAt: next } }).then(() => {
      showUndoToast(next ? `Completed “${task.name}”` : `Reopened “${task.name}”`, () => {
        void save.mutateAsync({ id: task.id, data: { completedAt: previous } });
      });
    });
  }

  function shutdown() {
    if (!data) return;
    const date = addCalendarDays(data.date, 1);
    const unfinished = data.unfinished;
    if (unfinished.length === 0) {
      showUndoToast("Nothing left to shut down.");
      return;
    }
    void Promise.allSettled(unfinished.map((task) => setFocus.mutateAsync({ id: task.id, date }))).then((results) => {
      const moved = unfinished.filter((_, index) => results[index]?.status === "fulfilled");
      if (moved.length === 0) return;
      showUndoToast(`Moved ${moved.length} to tomorrow`, () => {
        void Promise.allSettled(moved.map((task) => setFocus.mutateAsync({ id: task.id, date: data.date })));
      });
    });
  }

  const dateLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "Today";

  return (
    <Screen>
      <MobileHeader title="Today" subtitle={dateLabel} statusDot accountActions />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={today.isRefetching && !today.isPending}
            onRefresh={() => void today.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {today.isPending && !data ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : networkCopy ? (
          <EmptyState icon={Sun} title="Couldn't load today" description={networkCopy} />
        ) : !data ? (
          <EmptyState icon={Sun} title="Couldn't load today" description="Pull to retry." />
        ) : (
          <>
            <AnimatedPressable onPress={() => router.push("/(app)/inbox")} style={styles.inboxCard}>
              <View style={styles.inboxIcon}>
                <Inbox size={21} color={colors.primary} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.inboxTitleRow}>
                  <Text style={styles.title}>Inbox</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{data.inboxCount} active</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {data.inboxCount === 0 ? "Clear — capture from Quick Add" : `${data.inboxCount} waiting to triage`}
                </Text>
              </View>
              <View style={styles.inboxAdd}>
                <Plus size={22} color={colors.mutedForeground} />
              </View>
            </AnimatedPressable>

            {focusSession ? (
              <View style={styles.focusCard}>
                <View style={styles.focusTopline}>
                  <View style={[styles.liveDot, isPaused && styles.pausedDot]} />
                  <Text style={styles.focusEyebrow}>{isPaused ? "FOCUS PAUSED" : "FOCUS SESSION"}</Text>
                  <Text style={styles.focusTimer}>{formatElapsed(elapsed)}</Text>
                </View>
                <Text numberOfLines={3} style={styles.focusTitle}>{focusSession.name}</Text>
                <View style={styles.actions}>
                  <AnimatedPressable
                    accessibilityLabel={isPaused ? "Resume focus" : "Pause focus"}
                    disabled={pauseFocus.isPending || startFocus.isPending}
                    onPress={() => void (isPaused ? startFocus.mutateAsync(focusSession.id) : pauseFocus.mutateAsync(focusSession.id))}
                    style={styles.chip}
                  >
                    {isPaused ? <Play size={13} color={colors.primary} fill={colors.primary} /> : <Pause size={13} color={colors.primary} fill={colors.primary} />}
                    <Text style={styles.chipText}>{isPaused ? "Resume" : "Pause"}</Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    onPress={() => completeTask(focusSession)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>Complete</Text>
                  </AnimatedPressable>
                </View>
              </View>
            ) : null}

            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <Star size={15} color={colors.warning} fill={colors.warning} />
                <Text style={styles.sectionHeading}>Today focus</Text>
              </View>
              <Text style={styles.metric}>{completedFocusCount}/{focusCount} · max {MAX_TODAY_FOCUS}</Text>
            </View>
            <Text style={styles.sectionCopy}>Star up to 7 tasks for today. This is independent of deadlines.</Text>
            {data.todayFocus.length > 0 ? (
              data.todayFocus.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.name}
                  meta={task.priorityLevel ?? undefined}
                  onPress={() => openTask(task.id)}
                  accent={taskEntityColor(task)}
                  active={focusSession?.id === task.id}
                  done={Boolean(task.completedAt)}
                  onComplete={() => completeTask(task)}
                >
                  {focusSession?.id === task.id || task.completedAt ? null : (
                    <AnimatedPressable onPress={() => void startFocus.mutateAsync(task.id)} style={styles.chip}>
                      <Text style={styles.chipText}>Start</Text>
                    </AnimatedPressable>
                  )}
                  <AnimatedPressable
                    accessibilityLabel={`Remove ${task.name} from today`}
                    onPress={() => void setFocus.mutateAsync({ id: task.id, date: null })}
                    style={styles.iconChip}
                  >
                    <Star size={16} color={colors.primary} />
                  </AnimatedPressable>
                </TaskRow>
              ))
            ) : null}
            {remainingSlots > 0 ? (
              <AnimatedPressable onPress={openPicker} style={styles.addFocus}>
                <Plus size={16} color={colors.primary} />
                <Text style={styles.addFocusText}>Add to today ({remainingSlots} left)</Text>
              </AnimatedPressable>
            ) : null}

            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionHeading}>Scheduled</Text>
                <View style={styles.sectionCount}>
                  <Text style={styles.sectionCountText}>{scheduled.length}</Text>
                </View>
              </View>
              <AnimatedPressable onPress={() => router.push("/(app)/(tabs)/calendar")} style={styles.timelineLink}>
                <Text style={styles.timelineText}>Timeline Mode</Text>
                <ChevronRight size={14} color={colors.primary} />
              </AnimatedPressable>
            </View>
            {scheduled.length === 0 ? (
              <Text style={styles.meta}>Nothing on the calendar today.</Text>
            ) : (
              <View style={styles.timelineList}>{scheduled.map((item) => {
                const meet = meetingUrl(item);
                const isFocusing = Boolean(item.taskId && item.taskId === focusingId);
                return (
                  <View key={item.id} style={styles.timelineRow}>
                    <View style={styles.timelineTime}><Text style={styles.timelineClock}>{item.allDay ? "ALL" : formatClock(item.start)}</Text><View style={[styles.timelineDot, { backgroundColor: item.task ? taskEntityColor(item.task) : (item.color ?? colors.primary) }]} /></View>
                  <TaskRow
                    key={item.id}
                    timeline
                    title={item.title}
                    meta={item.allDay ? "All day" : isFocusing ? `${formatClock(item.start)} — ${formatClock(item.end)}  ·  In Focus` : `${item.reminder ? "Reminder · " : ""}${formatClock(item.start)}`}
                    onPress={() => openItem(item)}
                    accent={item.task ? taskEntityColor(item.task) : (item.color ?? colors.mutedForeground)}
                    active={isFocusing}
                    done={Boolean(item.completedAt || item.task?.completedAt)}
                    onComplete={item.task ? () => completeTask(item.task!) : undefined}
                  >
                    {meet ? (
                      <AnimatedPressable
                        accessibilityLabel="Join call"
                        onPress={() => void Linking.openURL(meet)}
                        style={styles.iconChip}
                      >
                        <Video size={16} color={colors.primary} />
                      </AnimatedPressable>
                    ) : isFocusing ? (
                      <AnimatedPressable
                        accessibilityLabel="Pause focus"
                        onPress={() => void pauseFocus.mutateAsync(item.taskId!)}
                        hitSlop={8}
                      >
                        <Pause size={18} color={colors.primary} fill={colors.primary} />
                      </AnimatedPressable>
                    ) : null}
                  </TaskRow>
                  </View>
                );
              })}</View>
            )}

            {data.overdue.length > 0 ? (
              <>
                <View style={styles.sectionHead}>
                  <View style={styles.sectionTitleRow}>
                    <View style={styles.dangerDot} />
                    <Text style={styles.overdueHeading}>Overdue</Text>
                    <View style={styles.overdueCount}>
                      <Text style={styles.overdueCountText}>{data.overdue.length} pending</Text>
                    </View>
                  </View>
                  <AnimatedPressable onPress={() => router.push("/(app)/(tabs)/calendar")}>
                    <Text style={styles.reschedule}>Reschedule all</Text>
                  </AnimatedPressable>
                </View>
                {data.overdue.map((task) => (
                  <TaskRow
                    key={task.id}
                    title={task.name}
                    meta={overdueLabel(task.deadline)}
                    onPress={() => openTask(task.id)}
                    accent={taskEntityColor(task)}
                    danger
                    done={Boolean(task.completedAt)}
                    onComplete={() => completeTask(task)}
                  />
                ))}
              </>
            ) : null}

            <Text style={[styles.sectionHeading, styles.endOfDayHeading]}>End of day</Text>
            {data.unfinished.length === 0 ? (
              <Text style={styles.meta}>All of today’s focus is done.</Text>
            ) : (
              <>
                <Text style={styles.meta}>
                  {data.unfinished.length} unfinished — move them to tomorrow’s focus.
                </Text>
                <AnimatedPressable onPress={shutdown} style={styles.shutdownButton}>
                  <Moon size={20} color={colors.primaryForeground} />
                  <Text style={styles.shutdownText}>Shut down day</Text>
                </AnimatedPressable>
              </>
            )}
          </>
        )}
      </ScrollView>
      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add to today" footer={<View style={styles.pickerFooter}><Text style={styles.pickerFooterCount}>{pickerSelected.length} selected · {remainingSlots} slots left</Text><AnimatedPressable accessibilityRole="button" accessibilityLabel={`Add ${pickerSelected.length} selected tasks to today`} disabled={pickerSelected.length === 0} onPress={() => void addSelectedToToday()} style={[styles.pickerSubmit, pickerSelected.length === 0 && styles.pickerSubmitDisabled]}><Text style={styles.pickerSubmitText}>Add Selected ({pickerSelected.length})</Text></AnimatedPressable></View>}>
        <Text style={styles.pickerHint}>{pickerCandidates.length} available · Choose up to {remainingSlots} tasks</Text>
        {pickerCandidates.length === 0 ? (
          <Text style={styles.meta}>No open work left to star.</Text>
        ) : (
          pickerGroups.map(([group, groupTasks]) => <View key={group} style={styles.pickerGroup}>
            <View style={styles.pickerGroupHead}><Text style={styles.pickerGroupTitle}>{group}</Text><Text style={styles.pickerGroupCount}>{groupTasks.length} tasks</Text></View>
            {groupTasks.map((task) => (
            <AnimatedPressable
              key={task.id}
              onPress={() => togglePicker(task.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: pickerSelected.includes(task.id) }}
              style={[styles.pickerRow, pickerSelected.includes(task.id) && styles.pickerRowSelected]}
            >
              <View style={[styles.pickerCheck, pickerSelected.includes(task.id) && styles.pickerCheckSelected]}>{pickerSelected.includes(task.id) ? <Check size={13} color={colors.primaryForeground} /> : null}</View>
              <View style={styles.pickerCopy}><Text style={styles.pickerTaskTitle}>{task.name}</Text><Text style={styles.pickerTaskMeta}>{task.priorityLevel ?? "Task"}{task.duration ? ` · ${task.duration}m` : ""}</Text></View>
            </AnimatedPressable>
            ))}
          </View>)
        )}
      </BottomSheet>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { paddingHorizontal: 16, paddingTop: 20, gap: 12, paddingBottom: 130 },
  loader: { paddingVertical: 80, alignItems: "center", justifyContent: "center" },
  inboxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    minHeight: 70,
    marginBottom: 6,
  },
  inboxIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  inboxTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inboxAdd: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  countPill: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.card },
  countPillText: { color: colors.primary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  focusCard: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    padding: 20,
    gap: 10,
    marginBottom: 12,
  },
  focusTopline: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  pausedDot: { opacity: 0.45 },
  focusEyebrow: { color: colors.primary, fontSize: 10, fontWeight: "700", letterSpacing: 1, flex: 1 },
  focusTimer: { color: colors.primary, fontSize: 16, fontFamily: "SpaceMono", fontWeight: "700", fontVariant: ["tabular-nums"] },
  focusTitle: { color: colors.foreground, fontSize: 21, fontWeight: "800", lineHeight: 27 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionHeading: { color: colors.foreground, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  endOfDayHeading: { color: colors.mutedForeground, marginTop: 22, marginBottom: -4 },
  sectionCopy: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  metric: { color: colors.mutedForeground, fontSize: 12, fontFamily: "SpaceMono", fontVariant: ["tabular-nums"] },
  sectionCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  sectionCountText: { color: colors.mutedForeground, fontSize: 11, fontFamily: "SpaceMono" },
  timelineLink: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 36 },
  timelineText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  row: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 70,
    paddingVertical: 15,
    paddingRight: 13,
    paddingLeft: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  timelineList: { gap: 0 },
  timelineRow: { flexDirection: "row", gap: 10, alignItems: "stretch", paddingBottom: 8 },
  timelineTime: { width: 56, alignItems: "flex-end", justifyContent: "flex-start", paddingTop: 13, borderRightWidth: 1, borderRightColor: colors.border, paddingRight: 11 },
  timelineClock: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", lineHeight: 15 },
  timelineDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, right: -4, top: 18 },
  timelineCard: { flex: 1, minWidth: 0 },
  rowDone: { opacity: 0.78 },
  rowRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  rowActive: {
    backgroundColor: colors.accent,
  },
  rowDanger: { minHeight: 58 },
  checkRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkRingActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.accent },
  checkRingDone: { backgroundColor: colors.success, borderColor: colors.success },
  checkRingDanger: { width: 18, height: 18, borderColor: "rgba(244,63,94,0.55)" },
  title: { color: colors.foreground, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  titleDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 3 },
  metaActive: { color: colors.primary, fontFamily: "SpaceMono", fontWeight: "700" },
  metaDanger: { color: "#F43F5E", fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", textTransform: "uppercase" },
  actions: { flexDirection: "row", gap: 8 },
  chip: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  chipText: { color: colors.foreground, fontSize: 11, fontWeight: "700" },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
  addFocus: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    backgroundColor: colors.accent,
    marginBottom: 18,
  },
  addFocusText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  dangerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#F43F5E" },
  overdueHeading: { color: "#F43F5E", fontSize: 12, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  overdueCount: { borderRadius: 10, borderWidth: 1, borderColor: "rgba(244,63,94,0.25)", backgroundColor: "rgba(244,63,94,0.1)", paddingHorizontal: 8, paddingVertical: 4 },
  overdueCountText: { color: "#F43F5E", fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700" },
  reschedule: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", paddingVertical: 10 },
  shutdownButton: {
    height: 52,
    borderRadius: 20,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 6,
  },
  shutdownText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "700" },
  pickerHint: { color: colors.mutedForeground, fontSize: 12, marginBottom: 15 },
  pickerGroup: { gap: 6, marginBottom: 16 },
  pickerGroupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 3 },
  pickerGroupTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontWeight: "800" },
  pickerGroupCount: { color: colors.mutedForeground, fontSize: 11, fontFamily: "SpaceMono" },
  pickerRow: { flexDirection: "row", alignItems: "center", minHeight: 62, gap: 11, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pickerRowSelected: { backgroundColor: colors.accent, borderColor: colors.primary },
  pickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  pickerCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerCopy: { flex: 1, minWidth: 0, gap: 2 },
  pickerTaskTitle: { color: colors.foreground, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  pickerTaskMeta: { color: colors.mutedForeground, fontSize: 11 },
  pickerFooter: { gap: 8 },
  pickerFooterCount: { color: colors.mutedForeground, fontSize: 11, textAlign: "center" },
  pickerSubmit: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.primary },
  pickerSubmitDisabled: { opacity: 0.4 },
  pickerSubmitText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "800" },
}));
