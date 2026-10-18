import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
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
import { addCalendarDays, formatDuration, formatTime } from "../../../lib/format";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { showUndoToast } from "../../../lib/toast";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import type { CalendarItem, Task } from "../../../lib/types";
import { taskEntityColor } from "../../../lib/entityColor";
import { normalizePriority } from "../../../lib/priority";
import { eventHref } from "../../../lib/eventOccurrence";
import { findMeetingUrl } from "../../../lib/meetingUrl";
import TimelyLogo from "../../../components/ui/TimelyLogo";
import { Button, SectionLabel } from "../../../components/ui/primitives";
import TodaySuggestionsCard from "../../../components/tasks/TodaySuggestionsCard";
import HabitsGoalsCard from "../../../components/tasks/HabitsGoalsCard";
import ScreenTip from "../../../components/ui/ScreenTip";
import { useFabScrollInset } from "../../../components/ui/FloatingTabBar";

const MAX_TODAY_FOCUS = 7;

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function meetingUrl(item: CalendarItem) {
  return findMeetingUrl([item.event?.description, item.task?.description].filter(Boolean).join("\n"));
}

/** A card on Today: icon, title, a line of meta and an action, like the
 * desktop Today panels. */
function Panel({
  icon,
  title,
  meta,
  action,
  tone,
  testID,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  tone?: "danger";
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.panel} testID={testID}>
      <View style={styles.panelHead}>
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel compact action={action}>
            <Text style={tone === "danger" ? styles.dangerTitle : undefined}>{title}</Text>
          </SectionLabel>
        </View>
      </View>
      {meta ? <View style={styles.panelMeta}>{meta}</View> : null}
      <View>{children}</View>
    </View>
  );
}

/** One row inside a Today card: colour stripe, optional time, tick, title and
 * meta, with actions on the right. Rows are split by hairlines. */
function ListRow({
  title,
  meta,
  time,
  onPress,
  accent,
  active,
  danger,
  done,
  reminder,
  first,
  onComplete,
  children,
}: {
  title: string;
  meta?: string | null;
  time?: string;
  onPress: () => void;
  accent?: string;
  active?: boolean;
  danger?: boolean;
  done?: boolean;
  reminder?: boolean;
  first?: boolean;
  onComplete?: () => void;
  children?: ReactNode;
}) {
  return (
    <AnimatedPressable onPress={onPress} style={[styles.row, !first && styles.rowDivider, active && styles.rowActive]}>
      {time ? <Text style={styles.rowTime}>{time}</Text> : null}
      <View style={[styles.rowRail, { backgroundColor: reminder ? colors.warning : (accent ?? colors.mutedForeground) }]} pointerEvents="none" />
      {onComplete ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(done) }}
          accessibilityLabel={`Complete ${title}`}
          onPress={onComplete}
          hitSlop={10}
          style={[styles.checkRing, danger && styles.checkRingDanger, active && styles.checkRingActive, done && styles.checkRingDone]}
        >
          {done ? <Check size={11} color={colors.background} /> : null}
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[styles.title, done && styles.titleDone]}>{title}</Text>
        {meta ? (
          <Text numberOfLines={1} style={[styles.meta, active && styles.metaActive, danger && styles.metaDanger, reminder && styles.metaReminder]}>
            {meta}
          </Text>
        ) : null}
      </View>
      {children}
    </AnimatedPressable>
  );
}

/** Today focus has seven slots: done, still open, and free. */
function SlotMeter({ done, open }: { done: number; open: number }) {
  return (
    <View style={styles.slots} accessibilityLabel={`${done} done, ${open} open of ${MAX_TODAY_FOCUS} slots`}>
      {Array.from({ length: MAX_TODAY_FOCUS }, (_, i) => (
        <View
          key={i}
          style={[styles.slot, i < done ? styles.slotDone : i < done + open ? styles.slotOpen : null]}
        />
      ))}
    </View>
  );
}

function Metric({ label, value, hint, color }: { label: string; value: number; hint?: string; color: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, { color }]}>
        {value}
        {hint ? <Text style={styles.metricHint}> {hint}</Text> : null}
      </Text>
      <Text numberOfLines={1} style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatCountdown(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function shortDay(stamp: string) {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Due today · 45m · Mobile polish", the same facts as the desktop row. */
function focusMeta(task: Task, day: string) {
  const parts: string[] = [];
  if (task.deadline) {
    const stamp = task.deadline.slice(0, 10);
    parts.push(stamp < day ? `Overdue ${shortDay(stamp)}` : stamp === day ? "Due today" : `Due ${shortDay(stamp)}`);
  }
  const priority = normalizePriority(task.priorityLevel);
  if (priority === "High" || priority === "Urgent") parts.push(priority);
  const estimate = task.duration > 0 ? formatDuration(task.duration) : null;
  if (estimate) parts.push(estimate);
  const place = task.project?.title || task.workspace?.name;
  if (place) parts.push(place);
  return parts.join(" · ") || null;
}

function scheduleMeta(item: CalendarItem, focusing: boolean) {
  if (item.reminder) return "Reminder";
  if (item.allDay) return item.taskId ? "Focus block" : "Event";
  const range = `${formatTime(item.start)} – ${formatTime(item.end)}`;
  if (focusing) return `${range} · In focus`;
  return `${range} · ${item.taskId ? "Focus block" : "Event"}`;
}

function overdueLabel(deadline?: string | null) {
  return deadline ? `Due ${shortDay(deadline)}` : "Overdue";
}

// Same clock format as the desktop agenda and the rest of the phone app.
const formatClock = formatTime;

export default function HomeScreen() {
  const fabInset = useFabScrollInset();
  const router = useRouter();
  const today = useTodayQuery();
  const queryClient = useQueryClient();
  const tasks = useTasksQuery();
  const startFocus = useStartFocus();
  const pauseFocus = usePauseFocus();
  const setFocus = useSetTodayFocus();
  const save = useSaveTask();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useAssistantScreen([contextChip("today", "Today", { date: new Date(now).toLocaleDateString("en-CA"), selectedTaskIds: pickerSelected })]);
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
  // Left for tomorrow: open work from today's calendar plus open focus tasks
  // that never got a time (the server's `unfinished` only covers the first).
  const leftover = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return [...data.unfinished, ...data.todayFocus.filter((task) => !task.completedAt)].filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  }, [data]);
  const remainingSlots = Math.max(0, MAX_TODAY_FOCUS - focusCount);
  const remainingEstimate = (data?.todayFocus ?? [])
    .filter((task) => !task.completedAt)
    .reduce((sum, task) => sum + Math.max(task.duration ?? 0, 0), 0);
  const orderedFocus = useMemo(() => {
    const rows = data?.todayFocus ?? [];
    const activeId = focusSession?.id;
    return [
      ...rows.filter((task) => task.id === activeId),
      ...rows.filter((task) => task.id !== activeId && !task.completedAt),
      ...rows.filter((task) => task.id !== activeId && task.completedAt),
    ];
  }, [data?.todayFocus, focusSession?.id]);

  // The clock ticks every second in a focus session, else once a minute so
  // the now line and "Next in" stay true.
  useEffect(() => {
    if (focusingId) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [focusingId]);

  const scheduleRows = useMemo(() => {
    const sorted = [...scheduled].sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.localeCompare(b.start);
    });
    const rows: ({ kind: "item"; item: CalendarItem } | { kind: "now" })[] = [];
    let placed = false;
    for (const item of sorted) {
      if (!placed && !item.allDay && new Date(item.start).getTime() > now) {
        rows.push({ kind: "now" });
        placed = true;
      }
      rows.push({ kind: "item", item });
    }
    if (!placed && sorted.length > 0) rows.push({ kind: "now" });
    return rows;
  }, [now, scheduled]);
  const nextItem = useMemo(() => {
    const starts = scheduled
      .filter((item) => !item.allDay && !item.reminder)
      .map((item) => new Date(item.start).getTime())
      .filter((start) => start > now)
      .sort((a, b) => a - b);
    return starts.length ? { start: starts[0] } : null;
  }, [now, scheduled]);

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
    if (item.eventId) router.push(eventHref(item));
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
    const unfinished = leftover;
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
      <ScrollView showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.body, { paddingBottom: fabInset }]}
        refreshControl={
          <RefreshControl
            refreshing={today.isRefetching && !today.isPending}
            onRefresh={() => {
              void today.refetch();
              for (const key of ["habits", "goals", "goal-progress"]) void queryClient.invalidateQueries({ queryKey: [key] });
            }}
            tintColor={colors.primary}
          />
        }
      >
        {today.isPending && !data ? (
          <View style={styles.loader}>
            <TimelyLogo size={44} animated />
          </View>
        ) : networkCopy ? (
          <EmptyState icon={Sun} title="Couldn't load today" description={networkCopy} />
        ) : !data ? (
          <EmptyState icon={Sun} title="Couldn't load today" description="Pull to retry." />
        ) : (
          <>
            <HabitsGoalsCard today={data.date} version={String(today.dataUpdatedAt)} onOpenTask={openTask} />

            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={`Inbox, ${data.inboxCount} waiting to triage`}
              onPress={() => router.push("/(app)/inbox")}
              style={styles.inboxRow}
            >
              <Inbox size={17} color={colors.primary} strokeWidth={1.8} />
              <Text style={styles.inboxTitle}>Inbox</Text>
              <Text numberOfLines={1} style={[styles.inboxMeta, data.inboxCount > 0 && styles.inboxMetaWaiting]}>
                {data.inboxCount === 0 ? "Clear" : `${data.inboxCount} waiting to triage`}
              </Text>
              <ChevronRight size={16} color={colors.mutedForeground} />
            </AnimatedPressable>

            {focusSession ? (
              <View style={styles.focusCard}>
                <View style={styles.focusTopline}>
                  <View style={[styles.liveDot, isPaused && styles.pausedDot]} />
                  <Text style={styles.focusEyebrow}>{isPaused ? "Focus paused" : "Focusing now"}</Text>
                  <Text style={styles.focusTimer}>{formatElapsed(elapsed)}</Text>
                </View>
                <Text numberOfLines={2} style={styles.focusTitle}>{focusSession.name}</Text>
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    variant="outline"
                    label={isPaused ? "Resume" : "Pause"}
                    icon={isPaused ? <Play size={14} color={colors.foreground} /> : <Pause size={14} color={colors.foreground} />}
                    disabled={pauseFocus.isPending || startFocus.isPending}
                    onPress={() => void (isPaused ? startFocus.mutateAsync(focusSession.id) : pauseFocus.mutateAsync(focusSession.id))}
                  />
                  <Button size="sm" variant="outline" label="Complete" onPress={() => completeTask(focusSession)} />
                </View>
              </View>
            ) : null}

            <Panel
              icon={<Star size={16} color={colors.warning} fill={colors.warning} />}
              title="Today focus"
              testID="today-focus"
              meta={
                focusCount > 0 ? (
                  <View style={styles.metaRow}>
                    <Text style={styles.metric}>
                      {completedFocusCount} of {focusCount} done
                      {remainingEstimate > 0 ? ` · ${formatDuration(remainingEstimate)} left` : ""}
                    </Text>
                    <SlotMeter done={completedFocusCount} open={focusCount - completedFocusCount} />
                  </View>
                ) : null
              }
            >
              {data.todayFocus.length === 0 ? (
                <Text style={styles.empty}>Star up to {MAX_TODAY_FOCUS} tasks for today, whatever their deadlines.</Text>
              ) : (
                orderedFocus.map((task, index) => {
                  const active = focusSession?.id === task.id;
                  const done = Boolean(task.completedAt);
                  return (
                    <ListRow
                      key={task.id}
                      first={index === 0}
                      title={task.name}
                      meta={done ? "Done" : focusMeta(task, data.date)}
                      onPress={() => openTask(task.id)}
                      accent={taskEntityColor(task)}
                      active={active}
                      done={done}
                      onComplete={() => completeTask(task)}
                    >
                      {active || done ? null : (
                        <AnimatedPressable
                          accessibilityRole="button"
                          accessibilityLabel={`Start focus on ${task.name}`}
                          onPress={() => void startFocus.mutateAsync(task.id)}
                          style={styles.chip}
                        >
                          <Text style={styles.chipText}>Start</Text>
                        </AnimatedPressable>
                      )}
                      <AnimatedPressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${task.name} from today`}
                        onPress={() => void setFocus.mutateAsync({ id: task.id, date: null })}
                        hitSlop={6}
                        style={styles.iconChip}
                      >
                        <Star size={16} color={done ? colors.mutedForeground : colors.warning} fill={done ? "transparent" : colors.warning} />
                      </AnimatedPressable>
                    </ListRow>
                  );
                })
              )}
              {remainingSlots > 0 ? (
                <AnimatedPressable accessibilityRole="button" onPress={openPicker} style={styles.addRow}>
                  <Plus size={15} color={colors.primary} />
                  <Text style={styles.addRowText}>
                    Add a task · {remainingSlots} slot{remainingSlots === 1 ? "" : "s"} left
                  </Text>
                </AnimatedPressable>
              ) : null}
            </Panel>

            <ScreenTip screen="today" />

            <TodaySuggestionsCard
              date={data.date}
              slotsLeft={remainingSlots}
              onOpenTask={openTask}
              version={`${data.todayFocus.map((task) => task.id).join(",")}|${scheduled.map((item) => item.id).join(",")}`}
            />

            <Panel
              icon={<Clock size={16} color={colors.primary} />}
              title="Schedule"
              testID="today-schedule"
              meta={
                nextItem ? (
                  <Text numberOfLines={1} style={styles.metric}>
                    Next in {formatCountdown(nextItem.start - now)}
                  </Text>
                ) : null
              }
              action={
                <AnimatedPressable
                  accessibilityRole="link"
                  accessibilityLabel="Open Calendar"
                  onPress={() => router.push("/(app)/(tabs)/calendar")}
                  hitSlop={8}
                  style={styles.headerLink}
                >
                  <Text style={styles.headerLinkText}>Calendar</Text>
                  <ChevronRight size={14} color={colors.primary} />
                </AnimatedPressable>
              }
            >
              {scheduled.length === 0 ? (
                <Text style={styles.empty}>Nothing on the calendar today.</Text>
              ) : (
                scheduleRows.map((row, index) => {
                  if (row.kind === "now") {
                    return (
                      <View key="now" style={styles.nowRow} accessibilityLabel={`Now, ${formatClock(new Date(now).toISOString())}`}>
                        <Text style={styles.nowText}>{formatClock(new Date(now).toISOString())}</Text>
                        <View style={styles.nowDot} />
                        <View style={styles.nowLine} />
                      </View>
                    );
                  }
                  const item = row.item;
                  const meet = meetingUrl(item);
                  const isFocusing = Boolean(item.taskId && item.taskId === focusingId);
                  return (
                    <ListRow
                      key={item.id}
                      first={index === 0 || scheduleRows[index - 1]?.kind === "now"}
                      time={item.allDay ? "All day" : formatClock(item.start)}
                      title={item.title}
                      meta={scheduleMeta(item, isFocusing)}
                      onPress={() => openItem(item)}
                      accent={item.task ? taskEntityColor(item.task) : (item.color ?? colors.mutedForeground)}
                      active={isFocusing}
                      reminder={item.reminder}
                      done={Boolean(item.completedAt || item.task?.completedAt)}
                      onComplete={item.task ? () => completeTask(item.task!) : undefined}
                    >
                      {meet ? (
                        <AnimatedPressable
                          accessibilityRole="link"
                          accessibilityLabel="Join call"
                          onPress={() => void Linking.openURL(meet)}
                          style={styles.iconChip}
                        >
                          <Video size={16} color={colors.primary} />
                        </AnimatedPressable>
                      ) : isFocusing ? (
                        <AnimatedPressable
                          accessibilityRole="button"
                          accessibilityLabel="Pause focus"
                          onPress={() => void pauseFocus.mutateAsync(item.taskId!)}
                          style={styles.iconChip}
                        >
                          <Pause size={16} color={colors.primary} fill={colors.primary} />
                        </AnimatedPressable>
                      ) : null}
                    </ListRow>
                  );
                })
              )}
            </Panel>

            {data.overdue.length > 0 ? (
              <Panel
                icon={<CalendarClock size={16} color={colors.destructive} />}
                title="Overdue"
                tone="danger"
                testID="today-overdue"
                action={
                  <AnimatedPressable
                    accessibilityRole="link"
                    onPress={() => router.push("/(app)/(tabs)/calendar")}
                    hitSlop={8}
                    style={styles.headerLink}
                  >
                    <Text style={styles.headerLinkText}>Reschedule</Text>
                    <ChevronRight size={14} color={colors.primary} />
                  </AnimatedPressable>
                }
              >
                {data.overdue.map((task, index) => (
                  <ListRow
                    key={task.id}
                    first={index === 0}
                    title={task.name}
                    meta={overdueLabel(task.deadline)}
                    onPress={() => openTask(task.id)}
                    accent={taskEntityColor(task)}
                    danger
                    done={Boolean(task.completedAt)}
                    onComplete={() => completeTask(task)}
                  />
                ))}
              </Panel>
            ) : null}

            <Panel icon={<Moon size={16} color={colors.primary} />} title="End of day" testID="today-shutdown">
              <View style={styles.metrics}>
                <Metric label="Done" value={data.completedToday.length} hint={focusCount > 0 ? `of ${focusCount}` : undefined} color={colors.success} />
                <Metric label="Unfinished" value={leftover.length} color={colors.warning} />
                <Metric label="Tomorrow" value={data.tomorrowFocus.length} color={colors.primary} />
              </View>
              <View style={styles.actions}>
                <Button
                  size="sm"
                  variant="outline"
                  label="Plan tomorrow"
                  onPress={() =>
                    router.push({ pathname: "/(app)/(tabs)/calendar", params: { date: addCalendarDays(data.date, 1), view: "day" } })
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label="Shut down day"
                  icon={<Moon size={14} color={colors.foreground} />}
                  disabled={leftover.length === 0}
                  onPress={shutdown}
                />
              </View>
            </Panel>
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
  body: { paddingHorizontal: 16, paddingTop: 16, gap: 12, paddingBottom: 130 },
  loader: { paddingVertical: 80, alignItems: "center", justifyContent: "center" },
  panel: { gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  panelMeta: { marginTop: -2 },
  dangerTitle: { color: colors.destructive },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  metric: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  slots: { flexDirection: "row", gap: 3 },
  slot: { width: 12, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  slotDone: { backgroundColor: colors.success },
  slotOpen: { backgroundColor: colors.primary },
  empty: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, paddingVertical: 6 },
  inboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  inboxTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  inboxMeta: { flex: 1, minWidth: 0, color: colors.mutedForeground, fontSize: 13 },
  inboxMetaWaiting: { color: colors.warning },
  focusCard: { backgroundColor: colors.accent, borderRadius: 16, padding: 14, gap: 8 },
  focusTopline: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  pausedDot: { opacity: 0.45 },
  focusEyebrow: { color: colors.primary, fontSize: 12, fontWeight: "600", flex: 1 },
  focusTimer: { color: colors.primary, fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  focusTitle: { color: colors.foreground, fontSize: 17, fontWeight: "600", lineHeight: 23 },
  headerLink: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
  headerLinkText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  row: { minHeight: 52, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowActive: { backgroundColor: colors.accent, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 },
  rowTime: { width: 58, color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  rowRail: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  nowRow: { flexDirection: "row", alignItems: "center", gap: 6, height: 18 },
  nowText: { width: 58, color: colors.destructive, fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.destructive },
  nowLine: { flex: 1, height: 2, borderRadius: 1, backgroundColor: colors.destructive },
  checkRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkRingActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.accent },
  checkRingDone: { backgroundColor: colors.success, borderColor: colors.success },
  checkRingDanger: { borderColor: colors.destructive },
  title: { color: colors.foreground, fontSize: 14, lineHeight: 19, fontWeight: "500" },
  titleDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },
  metaActive: { color: colors.primary, fontWeight: "600" },
  metaDanger: { color: colors.destructive },
  metaReminder: { color: colors.warning },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", paddingBottom: 6 },
  chip: { minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  chipText: { color: colors.foreground, fontSize: 12, fontWeight: "600" },
  iconChip: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  addRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  addRowText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  metrics: { flexDirection: "row", gap: 8, marginBottom: 8 },
  metricTile: { flex: 1, minWidth: 0, borderRadius: 10, backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 8 },
  metricValue: { fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  metricHint: { color: colors.mutedForeground, fontSize: 12, fontWeight: "400" },
  metricLabel: { color: colors.mutedForeground, fontSize: 11 },
  pickerHint: { color: colors.mutedForeground, fontSize: 12, marginBottom: 15 },
  pickerGroup: { gap: 6, marginBottom: 16 },
  pickerGroupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 3 },
  pickerGroupTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontWeight: "600" },
  pickerGroupCount: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  pickerRow: { flexDirection: "row", alignItems: "center", minHeight: 62, gap: 11, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pickerRowSelected: { backgroundColor: colors.accent, borderColor: colors.primary },
  pickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  pickerCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerCopy: { flex: 1, minWidth: 0, gap: 2 },
  pickerTaskTitle: { color: colors.foreground, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  pickerTaskMeta: { color: colors.mutedForeground, fontSize: 11 },
  pickerFooter: { gap: 8 },
  pickerFooterCount: { color: colors.mutedForeground, fontSize: 11, textAlign: "center" },
  pickerSubmit: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.primary },
  pickerSubmitDisabled: { opacity: 0.4 },
  pickerSubmitText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "600" },
}));
