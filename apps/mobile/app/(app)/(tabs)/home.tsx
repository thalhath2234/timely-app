import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Bell,
  ChevronRight,
  GripVertical,
  Inbox,
  Moon,
  Pause,
  Plus,
  Settings,
  Star,
  Sun,
  Video,
} from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet from "../../../components/ui/BottomSheet";
import {
  useSaveTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useTasksQuery,
  useTodayQuery,
  useUnreadNotificationCount,
} from "../../../lib/hooks";
import { addCalendarDays } from "../../../lib/format";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { showUndoToast } from "../../../lib/toast";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import type { CalendarItem, Task } from "../../../lib/types";

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
  onComplete,
  children,
}: {
  title: string;
  meta?: string | null;
  onPress: () => void;
  accent?: string;
  active?: boolean;
  danger?: boolean;
  onComplete?: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.row, active && styles.rowActive, danger && styles.rowDanger]}>
      <View style={[styles.rowRail, { backgroundColor: accent ?? "#526177" }]} />
      {onComplete ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Complete ${title}`}
          onPress={onComplete}
          hitSlop={8}
          style={[styles.checkRing, danger && styles.checkRingDanger, active && styles.checkRingActive]}
        />
      ) : null}
      <Pressable onPress={onPress} style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={danger ? 2 : 1} style={styles.title}>{title}</Text>
        {meta ? <Text style={[styles.meta, active && styles.metaActive, danger && styles.metaDanger]}>{meta}</Text> : null}
      </Pressable>
      {children}
    </View>
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
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const save = useSaveTask();
  const unread = useUnreadNotificationCount();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const data = today.data;
  const focusingId = data?.focusing?.id;
  const networkCopy = needsNetworkCopy(today);
  const unreadCount = unread.data ?? 0;

  useEffect(() => {
    if (!focusingId) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [focusingId]);

  const elapsed = data?.focusing?.focusStartedAt
    ? Math.max(0, Math.floor((now - new Date(data.focusing.focusStartedAt).getTime()) / 1000))
    : 0;

  const scheduled = useMemo(() => data?.items ?? [], [data?.items]);
  const focusCount = data?.todayFocus.length ?? 0;
  const remainingSlots = Math.max(0, MAX_TODAY_FOCUS - focusCount);

  const pickerCandidates = useMemo(() => {
    const starred = new Set((data?.todayFocus ?? []).map((task) => task.id));
    return (tasks.data ?? []).filter((task) => {
      if (starred.has(task.id) || task.completedAt) return false;
      if (task.kind === "inbox" || task.kind === "reminder") return false;
      if (task.parentTaskId) return false;
      return (task.duration ?? 0) > 0;
    });
  }, [data?.todayFocus, tasks.data]);

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
    void save.mutateAsync({ id: task.id, data: { completedAt: new Date().toISOString() } }).then(() => {
      showUndoToast(`Completed “${task.name}”`, () => {
        void save.mutateAsync({ id: task.id, data: { completedAt: previous || null } });
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
      <MobileHeader
        title="Today"
        subtitle={dateLabel}
        statusDot
        actions={
          <>
            <HeaderIconButton label="Notifications" onPress={() => router.push("/(app)/notifications")}>
              <View>
                <Bell size={20} color={colors.foreground} />
                {unreadCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                  </View>
                ) : null}
              </View>
            </HeaderIconButton>
            <HeaderIconButton label="Settings" onPress={() => router.push("/(app)/(tabs)/more")}>
              <Settings size={20} color={colors.foreground} />
            </HeaderIconButton>
          </>
        }
      />
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
          <Text style={styles.meta}>Loading today…</Text>
        ) : networkCopy ? (
          <EmptyState icon={Sun} title="Couldn't load today" description={networkCopy} />
        ) : !data ? (
          <EmptyState icon={Sun} title="Couldn't load today" description="Pull to retry." />
        ) : (
          <>
            <Pressable onPress={() => router.push("/(app)/inbox")} style={styles.inboxCard}>
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
            </Pressable>

            {data.focusing ? (
              <View style={styles.focusCard}>
                <View style={styles.focusTopline}>
                  <View style={styles.liveDot} />
                  <Text style={styles.focusEyebrow}>FOCUS SESSION</Text>
                  <Text style={styles.focusTimer}>{formatElapsed(elapsed)}</Text>
                </View>
                <Text numberOfLines={2} style={styles.focusTitle}>{data.focusing.name}</Text>
                <View style={styles.actions}>
                  <Pressable onPress={() => void stopFocus.mutateAsync(data.focusing!.id)} style={styles.chip}>
                    <Pause size={13} color={colors.primary} fill={colors.primary} />
                    <Text style={styles.chipText}>Pause</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void stopFocus.mutateAsync(data.focusing!.id).then(() => completeTask(data.focusing!));
                    }}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>Complete</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <Star size={15} color={colors.warning} fill={colors.warning} />
                <Text style={styles.sectionHeading}>Today focus</Text>
              </View>
              <Text style={styles.metric}>
                {data.todayFocus.filter((task) => task.completedAt).length}/{focusCount || 0} · max {MAX_TODAY_FOCUS}
              </Text>
            </View>
            <Text style={styles.sectionCopy}>Star up to 7 tasks for today. This is independent of deadlines.</Text>
            {data.todayFocus.length > 0 ? (
              data.todayFocus.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.name}
                  meta={task.priorityLevel ?? undefined}
                  onPress={() => openTask(task.id)}
                  accent={data.focusing?.id === task.id ? "#6366F1" : colors.warning}
                  active={data.focusing?.id === task.id}
                  onComplete={() => completeTask(task)}
                >
                  {data.focusing?.id === task.id ? null : (
                    <Pressable onPress={() => void startFocus.mutateAsync(task.id)} style={styles.chip}>
                      <Text style={styles.chipText}>Start</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityLabel={`Remove ${task.name} from today`}
                    onPress={() => void setFocus.mutateAsync({ id: task.id, date: null })}
                    style={styles.iconChip}
                  >
                    <Star size={16} color={colors.primary} />
                  </Pressable>
                </TaskRow>
              ))
            ) : null}
            {remainingSlots > 0 ? (
              <Pressable onPress={() => setPickerOpen(true)} style={styles.addFocus}>
                <Plus size={16} color={colors.primary} />
                <Text style={styles.addFocusText}>Add to today ({remainingSlots} left)</Text>
              </Pressable>
            ) : null}

            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionHeading}>Scheduled</Text>
                <View style={styles.sectionCount}>
                  <Text style={styles.sectionCountText}>{scheduled.length}</Text>
                </View>
              </View>
              <Pressable onPress={() => router.push("/(app)/(tabs)/calendar")} style={styles.timelineLink}>
                <Text style={styles.timelineText}>Timeline Mode</Text>
                <ChevronRight size={14} color="#06B6D4" />
              </Pressable>
            </View>
            {scheduled.length === 0 ? (
              <Text style={styles.meta}>Nothing on the calendar today.</Text>
            ) : (
              scheduled.map((item) => {
                const meet = meetingUrl(item);
                const isFocusing = Boolean(item.taskId && item.taskId === focusingId);
                return (
                  <TaskRow
                    key={item.id}
                    title={item.title}
                    meta={item.allDay ? "All day" : isFocusing ? `${formatClock(item.start)} — ${formatClock(item.end)}  ·  In Focus` : `${item.reminder ? "Reminder · " : ""}${formatClock(item.start)}`}
                    onPress={() => openItem(item)}
                    accent={isFocusing ? "#6366F1" : item.taskId ? "#06B6D4" : (item.color ?? "#526177")}
                    active={isFocusing}
                    onComplete={item.task ? () => completeTask(item.task!) : undefined}
                  >
                    {meet ? (
                      <Pressable
                        accessibilityLabel="Join call"
                        onPress={() => void Linking.openURL(meet)}
                        style={styles.iconChip}
                      >
                        <Video size={16} color={colors.primary} />
                      </Pressable>
                    ) : isFocusing ? (
                      <Pressable
                        accessibilityLabel="Pause focus"
                        onPress={() => void stopFocus.mutateAsync(item.taskId!)}
                        hitSlop={8}
                      >
                        <Pause size={18} color="#818CF8" fill="#818CF8" />
                      </Pressable>
                    ) : (
                      <GripVertical size={18} color="#526177" />
                    )}
                  </TaskRow>
                );
              })
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
                  <Pressable onPress={() => router.push("/(app)/(tabs)/calendar")}>
                    <Text style={styles.reschedule}>Reschedule all</Text>
                  </Pressable>
                </View>
                {data.overdue.map((task) => (
                  <TaskRow
                    key={task.id}
                    title={task.name}
                    meta={overdueLabel(task.deadline)}
                    onPress={() => openTask(task.id)}
                    accent="#F43F5E"
                    danger
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
                <Pressable onPress={shutdown} style={styles.shutdownButton}>
                  <Moon size={20} color="#FFFFFF" />
                  <Text style={styles.shutdownText}>Shut down day</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add to today">
        {pickerCandidates.length === 0 ? (
          <Text style={styles.meta}>No open work left to star.</Text>
        ) : (
          pickerCandidates.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => {
                if (!data || remainingSlots <= 0) return;
                void setFocus.mutateAsync({ id: task.id, date: data.date });
                setPickerOpen(false);
              }}
              style={styles.pickerRow}
            >
              <Text style={styles.title}>{task.name}</Text>
            </Pressable>
          ))
        )}
      </BottomSheet>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { paddingHorizontal: 16, paddingTop: 16, gap: 10, paddingBottom: 72 },
  inboxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    minHeight: 84,
    marginBottom: 14,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  inboxIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.35)",
    backgroundColor: "rgba(99,102,241,0.12)",
  },
  inboxTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inboxAdd: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  countPill: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: "#242B3A" },
  countPillText: { color: "#8290A7", fontSize: 10, fontFamily: "SpaceMono", fontVariant: ["tabular-nums"] },
  focusCard: {
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.7)",
    backgroundColor: colors.popover,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginBottom: 12,
    shadowColor: "#6366F1",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  focusTopline: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#818CF8" },
  focusEyebrow: { color: "#818CF8", fontSize: 10, fontWeight: "700", letterSpacing: 1, flex: 1 },
  focusTimer: { color: "#A5B4FC", fontSize: 16, fontFamily: "SpaceMono", fontWeight: "700", fontVariant: ["tabular-nums"] },
  focusTitle: { color: colors.foreground, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionHeading: { color: "#C7D0DD", fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  endOfDayHeading: { color: "#8B99B0", marginTop: 22, marginBottom: -4 },
  sectionCopy: { color: "#8B99B0", fontSize: 13, lineHeight: 19, marginBottom: 4 },
  metric: { color: "#8290A7", fontSize: 12, fontFamily: "SpaceMono", fontVariant: ["tabular-nums"] },
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
  sectionCountText: { color: "#8290A7", fontSize: 11, fontFamily: "SpaceMono" },
  timelineLink: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 36 },
  timelineText: { color: "#06B6D4", fontSize: 12, fontWeight: "700" },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 14,
    minHeight: 66,
    paddingVertical: 13,
    paddingRight: 13,
    paddingLeft: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  rowRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  rowActive: {
    backgroundColor: colors.popover,
    borderColor: "rgba(99,102,241,0.68)",
    shadowColor: "#6366F1",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  rowDanger: { minHeight: 58 },
  checkRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: "#46566D" },
  checkRingActive: { borderWidth: 2, borderColor: "#6366F1", backgroundColor: "rgba(99,102,241,0.14)" },
  checkRingDanger: { width: 18, height: 18, borderColor: "rgba(244,63,94,0.55)" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: "#8290A7", fontSize: 12, marginTop: 3 },
  metaActive: { color: "#818CF8", fontFamily: "SpaceMono", fontWeight: "700" },
  metaDanger: { color: "#F43F5E", fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700", textTransform: "uppercase" },
  actions: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  chipText: { color: colors.foreground, fontSize: 11, fontWeight: "700" },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 8,
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
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(99,102,241,0.62)",
    borderRadius: 13,
    backgroundColor: "rgba(99,102,241,0.045)",
    marginBottom: 14,
  },
  addFocusText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  dangerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#F43F5E" },
  overdueHeading: { color: "#F43F5E", fontSize: 12, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  overdueCount: { borderRadius: 10, borderWidth: 1, borderColor: "rgba(244,63,94,0.25)", backgroundColor: "rgba(244,63,94,0.1)", paddingHorizontal: 8, paddingVertical: 4 },
  overdueCountText: { color: "#F43F5E", fontSize: 10, fontFamily: "SpaceMono", fontWeight: "700" },
  reschedule: { color: "#8B99B0", fontSize: 12, fontWeight: "600", paddingVertical: 10 },
  shutdownButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#4F46E5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 6,
    shadowColor: "#6366F1",
    shadowOpacity: 0.36,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  shutdownText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  pickerRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.primaryForeground, fontSize: 9, fontWeight: "700" },
}));
