import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, Check, Inbox, Plus, Settings, Star, Sun, Video } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet from "../../../components/ui/BottomSheet";
import { PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
import {
  useSaveTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useTasksQuery,
  useTodayQuery,
  useUnreadNotificationCount,
} from "../../../lib/hooks";
import { addCalendarDays, formatTime } from "../../../lib/format";
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
  children,
}: {
  title: string;
  meta?: string | null;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{title}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </Pressable>
      {children}
    </View>
  );
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
              <Inbox size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Inbox</Text>
                <Text style={styles.meta}>
                  {data.inboxCount === 0 ? "Clear — capture from Quick Add" : `${data.inboxCount} waiting to triage`}
                </Text>
              </View>
            </Pressable>

            {data.focusing ? (
              <View style={styles.focusCard}>
                <SectionLabel>Focusing</SectionLabel>
                <Text style={styles.focusTimer}>{formatElapsed(elapsed)}</Text>
                <Text style={styles.title}>{data.focusing.name}</Text>
                <View style={styles.actions}>
                  <Pressable onPress={() => void stopFocus.mutateAsync(data.focusing!.id)} style={styles.chip}>
                    <Text style={styles.chipText}>Stop</Text>
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
              <SectionLabel>Today focus</SectionLabel>
              <Text style={styles.meta}>
                {data.todayFocus.filter((task) => task.completedAt).length}/{focusCount || 0} · max {MAX_TODAY_FOCUS}
              </Text>
            </View>
            {data.todayFocus.length === 0 ? (
              <Text style={styles.meta}>Star up to 7 tasks for today. This is independent of deadlines.</Text>
            ) : (
              data.todayFocus.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.name}
                  meta={task.priorityLevel ?? undefined}
                  onPress={() => openTask(task.id)}
                >
                  <Pressable
                    accessibilityLabel={`Complete ${task.name}`}
                    onPress={() => completeTask(task)}
                    style={styles.iconChip}
                  >
                    <Check size={16} color={colors.success} />
                  </Pressable>
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
            )}
            {remainingSlots > 0 ? (
              <Pressable onPress={() => setPickerOpen(true)} style={styles.addFocus}>
                <Plus size={16} color={colors.primary} />
                <Text style={styles.addFocusText}>Add to today ({remainingSlots} left)</Text>
              </Pressable>
            ) : null}

            <SectionLabel>Scheduled</SectionLabel>
            {scheduled.length === 0 ? (
              <Text style={styles.meta}>Nothing on the calendar today.</Text>
            ) : (
              scheduled.map((item) => {
                const meet = meetingUrl(item);
                return (
                  <TaskRow
                    key={item.id}
                    title={item.title}
                    meta={`${item.reminder ? "Reminder · " : ""}${item.allDay ? "All day" : formatTime(item.start)}`}
                    onPress={() => openItem(item)}
                  >
                    {meet ? (
                      <Pressable
                        accessibilityLabel="Join call"
                        onPress={() => void Linking.openURL(meet)}
                        style={styles.iconChip}
                      >
                        <Video size={16} color={colors.primary} />
                      </Pressable>
                    ) : null}
                  </TaskRow>
                );
              })
            )}

            {data.overdue.length > 0 ? (
              <>
                <SectionLabel>Overdue</SectionLabel>
                {data.overdue.map((task) => (
                  <TaskRow
                    key={task.id}
                    title={task.name}
                    meta={task.deadline ?? undefined}
                    onPress={() => openTask(task.id)}
                  />
                ))}
              </>
            ) : null}

            <SectionLabel>End of day</SectionLabel>
            {data.unfinished.length === 0 ? (
              <Text style={styles.meta}>All of today’s focus is done.</Text>
            ) : (
              <>
                <Text style={styles.meta}>
                  {data.unfinished.length} unfinished — move them to tomorrow’s focus.
                </Text>
                <PrimaryButton label="Shut down day" onPress={shutdown} />
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
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  inboxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
  },
  focusCard: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.accent,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  focusTimer: { color: colors.primary, fontSize: 28, fontWeight: "700", fontVariant: ["tabular-nums"] },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  chipText: { color: colors.foreground, fontSize: 12, fontWeight: "600" },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
  addFocus: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  addFocusText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
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
