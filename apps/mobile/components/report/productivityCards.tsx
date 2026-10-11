import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Minus, Plus, Search, Settings2, X } from "lucide-react-native";
import {
  completionsByDay,
  formatMinutes,
  goalSettings,
  nextUp,
  setReviewNote,
  shortDay,
  topThreeLeftover,
  topThreePicks,
  topThreeSuggestions,
  weeklyReview,
  workdayWindow,
  type GoalMetric,
} from "@timely/contract/dashboard";
import { dateInZone } from "@timely/contract/workStatus";
import type { CalendarItem, Task, WorkingHours } from "../../lib/types";
import { keys, useSaveTask } from "../../lib/hooks";
import { seriesColor } from "../../lib/dashboard";
import { formatTime, formatTimeRange } from "../../lib/format";
import { usePomodoroStore } from "../../lib/pomodoroStore";
import { showUndoToast, useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { AutosaveText, capturedLabel, untilLabel, useWeekFocus, type SettingsUpdate } from "./cardParts";

function toastError(error: unknown, fallback: string) {
  useToastStore.getState().show(error instanceof Error ? error.message : fallback);
}

/** Completes or reopens a task, with Undo, the way the Today screen does. */
function useToggleTask() {
  const save = useSaveTask();
  return (task: Task) => {
    const previous = task.completedAt ?? "";
    const next = task.completedAt ? "" : new Date().toISOString();
    save.mutate(
      { id: task.id, data: { completedAt: next } },
      {
        onSuccess: () =>
          showUndoToast(next ? `Completed “${task.name}”` : `Reopened “${task.name}”`, () =>
            save.mutate({ id: task.id, data: { completedAt: previous } }),
          ),
        onError: (error) => toastError(error, "Could not update the task"),
      },
    );
  };
}

/* Top 3 for today */

export function TopThreeCard({
  settings,
  tasks,
  loading,
  today,
  onSettings,
  onOpenTask,
}: {
  settings: Record<string, unknown>;
  tasks: Task[];
  loading: boolean;
  today: string;
  onSettings: SettingsUpdate;
  onOpenTask: (id: string) => void;
}) {
  const toggle = useToggleTask();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const picks = useMemo(() => topThreePicks(settings, today), [settings, today]);
  const leftover = useMemo(() => topThreeLeftover(settings, today, tasks), [settings, today, tasks]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const suggestions = useMemo(() => {
    if (!picking) return [];
    const needle = query.trim().toLowerCase();
    return topThreeSuggestions(tasks, today, picks)
      .filter((task) => !needle || task.name.toLowerCase().includes(needle))
      .slice(0, 60);
  }, [picking, query, tasks, today, picks]);
  const allDone = picks.length === 3 && picks.every((id) => Boolean(byId.get(id)?.completedAt));

  const pick = (id: string) => {
    onSettings((current) => {
      const now = topThreePicks(current, today);
      return { day: today, taskIds: now.includes(id) ? now : [...now, id].slice(0, 3) };
    });
    setPicking(false);
    setQuery("");
  };
  const remove = (id: string) => onSettings((current) => ({ day: today, taskIds: topThreePicks(current, today).filter((entry) => entry !== id) }));

  return (
    <View style={{ gap: 6 }}>
      {leftover.length > 0 && picks.length === 0 ? (
        <AnimatedPressable accessibilityRole="button" onPress={() => onSettings({ day: today, taskIds: leftover })} style={styles.secondaryButton}>
          <ArrowRight size={15} color={colors.foreground} />
          <Text style={styles.secondaryText}>
            Carry over {leftover.length} from yesterday
          </Text>
        </AnimatedPressable>
      ) : null}
      {picks.map((id) => {
        const task = byId.get(id);
        const done = Boolean(task?.completedAt);
        return (
          <View key={id} style={styles.pickRow}>
            <AnimatedPressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done, disabled: !task }}
              accessibilityLabel={task ? (done ? `Reopen ${task.name}` : `Complete ${task.name}`) : "Task not loaded"}
              disabled={!task}
              hitSlop={8}
              onPress={() => task && toggle(task)}
              style={[styles.check, done && styles.checkOn]}
            >
              {done ? <Check size={13} color={colors.primaryForeground} strokeWidth={3} /> : null}
            </AnimatedPressable>
            <AnimatedPressable accessibilityRole="button" disabled={!task} onPress={() => onOpenTask(id)} wrapStyle={{ flex: 1 }} style={{ flex: 1, paddingVertical: 4 }}>
              <Text style={[styles.rowTitle, done && styles.doneText, !task && styles.muted]} numberOfLines={1}>
                {task?.name ?? (loading ? "Loading…" : "Task no longer exists")}
              </Text>
            </AnimatedPressable>
            <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Remove ${task?.name ?? "task"} from Top 3`} hitSlop={8} onPress={() => remove(id)} style={styles.iconButton}>
              <X size={15} color={colors.mutedForeground} />
            </AnimatedPressable>
          </View>
        );
      })}
      {Array.from({ length: 3 - picks.length }, (_, index) => (
        <AnimatedPressable key={`slot-${index}`} accessibilityRole="button" onPress={() => setPicking(true)} style={styles.pickRow}>
          <View style={[styles.check, styles.checkEmpty]} />
          <Text style={[styles.muted, { flex: 1, paddingVertical: 4 }]}>Pick a task</Text>
          <Plus size={15} color={colors.mutedForeground} />
        </AnimatedPressable>
      ))}
      {allDone ? <Text style={[styles.small, { color: colors.success, fontWeight: "600" }]}>All three done</Text> : null}

      <BottomSheet
        open={picking}
        onClose={() => setPicking(false)}
        onClosed={() => setQuery("")}
        title="Pick a task for today"
      >
        <View style={styles.searchBox}>
          <Search size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search open tasks"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Search open tasks"
            selectionColor={colors.primary}
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>
        {suggestions.length === 0 ? (
          <Text style={[styles.muted, { paddingVertical: 16, textAlign: "center" }]}>{query.trim() ? "No open tasks match." : "No open tasks to pick."}</Text>
        ) : (
          suggestions.map((task) => {
            const deadline = task.deadline?.slice(0, 10);
            return (
              <AnimatedPressable key={task.id} accessibilityRole="button" onPress={() => pick(task.id)} style={styles.option}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {task.name}
                </Text>
                {deadline ? (
                  <Text style={[styles.small, deadline < today && { color: colors.destructive }]}>{deadline < today ? `Overdue · ${shortDay(deadline)}` : shortDay(deadline)}</Text>
                ) : null}
              </AnimatedPressable>
            );
          })
        )}
      </BottomSheet>
    </View>
  );
}

/* Focus time */

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function FocusTimeCard({
  tasks,
  today,
  now,
  timeZone,
  onOpenTask,
}: {
  tasks: Task[];
  today: string;
  now: Date;
  timeZone?: string;
  onOpenTask: (id: string) => void;
}) {
  const { summary, isLoading, isError } = useWeekFocus(tasks, today, now, timeZone);
  const timers = usePomodoroStore((store) => store.timers);
  const pomodoros = useMemo(() => Object.values(timers).reduce((sum, timer) => sum + (timer.history?.[today] ?? 0), 0), [timers, today]);
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...summary.days.map((entry) => entry.minutes));
  const pickedDay = picked === null ? null : summary.days[picked];

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.spread, { alignItems: "flex-end" }]}>
        <View>
          <Text style={styles.huge}>{formatMinutes(summary.today)}</Text>
          <Text style={styles.small}>today{pomodoros > 0 ? ` · ${pomodoros} ${pomodoros === 1 ? "pomodoro" : "pomodoros"}` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.strong}>{formatMinutes(summary.week)}</Text>
          <Text style={styles.small}>this week</Text>
        </View>
      </View>

      {isError ? <Text style={styles.small}>Couldn't load focus sessions.</Text> : null}

      <View>
        <Text style={styles.small}>{pickedDay ? `${shortDay(pickedDay.day)}: ${formatMinutes(pickedDay.minutes)}` : "Tap a day"}</Text>
        <View style={styles.miniChart} accessibilityLabel="Minutes focused per day this week">
          {summary.days.map((entry, index) => {
            const isToday = entry.day === today;
            const height = entry.minutes > 0 ? Math.max(3, (entry.minutes / max) * 56) : 2;
            return (
              <AnimatedPressable
                key={entry.day}
                accessibilityRole="button"
                accessibilityLabel={`${shortDay(entry.day)}: ${formatMinutes(entry.minutes)}`}
                disabled={entry.day > today}
                onPress={() => setPicked((current) => (current === index ? null : index))}
                wrapStyle={{ flex: 1 }}
                style={styles.miniColumn}
              >
                <View style={styles.miniTrack}>
                  <View
                    style={{
                      height,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      backgroundColor: entry.minutes > 0 ? (isToday ? colors.primary : seriesColor(0)) : colors.border,
                      opacity: entry.minutes > 0 && !isToday && picked !== index ? 0.55 : 1,
                    }}
                  />
                </View>
                <Text style={[styles.tiny, isToday && { color: colors.primary, fontWeight: "700" }]}>{WEEKDAY_LETTERS[index]}</Text>
              </AnimatedPressable>
            );
          })}
        </View>
      </View>

      {summary.tasks.length > 0 ? (
        <View>
          <Text style={styles.label}>Top tasks this week</Text>
          {summary.tasks.map((entry) => (
            <AnimatedPressable
              key={entry.id ?? `name:${entry.name}`}
              accessibilityRole="button"
              disabled={!entry.id}
              onPress={() => entry.id && onOpenTask(entry.id)}
              style={styles.listRow}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {entry.name}
              </Text>
              <Text style={styles.small}>{formatMinutes(entry.minutes)}</Text>
            </AnimatedPressable>
          ))}
        </View>
      ) : isLoading ? (
        <Text style={styles.small}>Loading…</Text>
      ) : (
        <Text style={styles.muted}>No focus tracked this week. Start focus on a task, or link a task to a pomodoro.</Text>
      )}
    </View>
  );
}

/* Next up */

export function NextUpCard({
  events,
  loading,
  now,
  today,
  workingHours,
  timeZone,
  onOpenItem,
}: {
  events: CalendarItem[];
  loading: boolean;
  now: Date;
  today: string;
  workingHours?: WorkingHours | null;
  timeZone?: string;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const info = useMemo(() => nextUp(events, now, workdayWindow(workingHours, now), timeZone), [events, now, workingHours, timeZone]);
  const next = info.next && dateInZone(new Date(info.next.start), timeZone) === today ? info.next : null;
  const laterDay = info.next && !next ? info.next : null;

  if (loading && events.length === 0) return <Text style={[styles.muted, { textAlign: "center", paddingVertical: 16 }]}>Loading your calendar…</Text>;

  return (
    <View style={{ gap: 10 }}>
      {info.current ? (
        <AnimatedPressable accessibilityRole="button" onPress={() => onOpenItem(info.current!)} style={styles.nowRow}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={styles.rowTitle} numberOfLines={1}>
            Now: {info.current.title} until {formatTime(info.current.end)}
          </Text>
        </AnimatedPressable>
      ) : null}

      {next ? (
        <AnimatedPressable accessibilityRole="button" onPress={() => onOpenItem(next)} style={{ gap: 2 }}>
          <Text style={styles.nextTitle} numberOfLines={2}>
            {next.title}
          </Text>
          <Text style={styles.muted}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>{untilLabel(new Date(next.start).getTime() - now.getTime())}</Text>
            {" · "}
            {formatTimeRange(next.start, next.end)}
          </Text>
        </AnimatedPressable>
      ) : (
        <View style={{ gap: 2 }}>
          <Text style={styles.muted}>Nothing else on the calendar today.</Text>
          {laterDay ? (
            <AnimatedPressable accessibilityRole="button" onPress={() => onOpenItem(laterDay)}>
              <Text style={styles.small} numberOfLines={1}>
                Next: {laterDay.title} · {shortDay(dateInZone(new Date(laterDay.start), timeZone))}, {formatTime(laterDay.start)}
              </Text>
            </AnimatedPressable>
          ) : null}
        </View>
      )}

      <Text style={styles.small}>
        {info.freeMinutes !== null
          ? `Free time left today: ${formatMinutes(info.freeMinutes)} of ${formatMinutes(info.workMinutesLeft ?? 0)}`
          : "Set working hours to see free time"}
      </Text>

      {info.later.length > 0 ? (
        <View>
          <Text style={styles.label}>Later today</Text>
          {info.later.slice(0, 5).map((item) => (
            <AnimatedPressable key={`${item.id}-${item.start}`} accessibilityRole="button" onPress={() => onOpenItem(item)} style={styles.listRow}>
              <Text style={[styles.small, { width: 64 }]}>{formatTime(item.start)}</Text>
              <View style={[styles.agendaBar, { backgroundColor: item.color ?? seriesColor(1) }]} />
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
            </AnimatedPressable>
          ))}
          {info.later.length > 5 ? <Text style={styles.tiny}>+{info.later.length - 5} more</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/* Daily goal */

const GOAL_RING = 140;
const GOAL_STROKE = 10;

function hoursText(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function GoalCard({
  settings,
  tasks,
  today,
  now,
  timeZone,
  onSettings,
}: {
  settings: Record<string, unknown>;
  tasks: Task[];
  today: string;
  now: Date;
  timeZone?: string;
  onSettings: SettingsUpdate;
}) {
  const goal = goalSettings(settings);
  const [editing, setEditing] = useState(false);
  const counts = useMemo(() => completionsByDay(tasks, timeZone), [tasks, timeZone]);
  const focus = useWeekFocus(tasks, today, now, timeZone, goal.metric === "focus");
  const value = goal.metric === "tasks" ? (counts.get(today) ?? 0) : focus.summary.today / 60;
  const reached = value >= goal.target;
  const progress = Math.min(1, Math.max(0, value / goal.target));
  const tint = reached ? colors.success : colors.primary;
  const radius = (GOAL_RING - GOAL_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const step = goal.metric === "focus" ? 0.5 : 1;
  const min = goal.metric === "focus" ? 0.5 : 1;
  const max = goal.metric === "focus" ? 16 : 50;

  const setTarget = (target: number) => onSettings({ ...goalSettings({ metric: goal.metric, target }) });
  const setMetric = (metric: GoalMetric) => {
    if (metric === goal.metric) return;
    // Each metric starts from its own default target: 5 tasks or 4 hours.
    onSettings({ ...goalSettings({ metric }) });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.goalRow}>
        <View style={{ width: GOAL_RING, height: GOAL_RING }}>
          <Svg width={GOAL_RING} height={GOAL_RING} style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={GOAL_RING / 2} cy={GOAL_RING / 2} r={radius} fill="none" stroke={tint} strokeOpacity={0.16} strokeWidth={GOAL_STROKE} />
            {progress > 0 ? (
              <Circle
                cx={GOAL_RING / 2}
                cy={GOAL_RING / 2}
                r={radius}
                fill="none"
                stroke={tint}
                strokeWidth={GOAL_STROKE}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
              />
            ) : null}
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={styles.big}>
              {goal.metric === "tasks" ? value : hoursText(value)} / {goal.metric === "tasks" ? goal.target : hoursText(goal.target)}
            </Text>
            <Text style={styles.small}>{goal.metric === "tasks" ? "tasks done" : "hours focused"}</Text>
          </View>
        </View>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={editing ? "Close goal settings" : "Goal settings"}
          onPress={() => setEditing((current) => !current)}
          style={styles.iconButton}
          wrapStyle={styles.cornerButton}
        >
          {editing ? <X size={16} color={colors.mutedForeground} /> : <Settings2 size={16} color={colors.mutedForeground} />}
        </AnimatedPressable>
      </View>
      {reached ? (
        <Text style={[styles.centerText, { color: colors.success, fontWeight: "700" }]}>Goal reached</Text>
      ) : (
        <Text style={[styles.small, { textAlign: "center" }]}>
          {goal.metric === "tasks"
            ? `${goal.target - value} more to go`
            : `${formatMinutes((goal.target - value) * 60)} more to go`}
        </Text>
      )}
      {goal.metric === "focus" && focus.isError ? <Text style={[styles.small, { textAlign: "center" }]}>Couldn't load focus sessions.</Text> : null}

      {editing ? (
        <View style={styles.panel}>
          <SegmentedControl
            options={[
              { label: "Tasks", value: "tasks" },
              { label: "Focus hours", value: "focus" },
            ]}
            value={goal.metric}
            onChange={setMetric}
          />
          <View style={styles.spread}>
            <Text style={styles.rowTitleFixed}>Daily target</Text>
            <View style={styles.inline}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Lower the target"
                disabled={goal.target <= min}
                onPress={() => setTarget(goal.target - step)}
                style={[styles.stepButton, goal.target <= min && { opacity: 0.35 }]}
              >
                <Minus size={16} color={colors.mutedForeground} />
              </AnimatedPressable>
              <Text style={[styles.strong, { minWidth: 56, textAlign: "center" }]}>
                {goal.metric === "tasks" ? goal.target : `${hoursText(goal.target)}h`}
              </Text>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Raise the target"
                disabled={goal.target >= max}
                onPress={() => setTarget(goal.target + step)}
                style={[styles.stepButton, goal.target >= max && { opacity: 0.35 }]}
              >
                <Plus size={16} color={colors.mutedForeground} />
              </AnimatedPressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* Weekly review */

type ReviewTab = "done" | "slipped" | "carried";
const REVIEW_TABS: { key: ReviewTab; label: string; empty: string }[] = [
  { key: "done", label: "Done", empty: "Nothing finished this week." },
  { key: "slipped", label: "Slipped", empty: "No deadlines slipped this week." },
  { key: "carried", label: "Carried over", empty: "Nothing carried over from earlier weeks." },
];
const REVIEW_MAX_WEEKS_BACK = 4;
const REVIEW_LIST = 8;

export function WeeklyReviewCard({
  settings,
  tasks,
  today,
  timeZone,
  onSettings,
  onOpenTask,
}: {
  settings: Record<string, unknown>;
  tasks: Task[];
  today: string;
  timeZone?: string;
  onSettings: SettingsUpdate;
  onOpenTask: (id: string) => void;
}) {
  const [weeksBack, setWeeksBack] = useState(0);
  const [tab, setTab] = useState<ReviewTab>("done");
  const [showAll, setShowAll] = useState(false);
  const review = useMemo(() => weeklyReview(tasks, today, weeksBack, timeZone), [tasks, today, weeksBack, timeZone]);
  const notes = settings.notes && typeof settings.notes === "object" ? (settings.notes as Record<string, unknown>) : {};
  const note = typeof notes[review.from] === "string" ? (notes[review.from] as string) : "";
  const list = review[tab];
  const shown = showAll ? list : list.slice(0, REVIEW_LIST);
  const weekLabel = weeksBack === 0 ? "This week" : weeksBack === 1 ? "Last week" : `${weeksBack} weeks ago`;

  const dayOf = (task: Task) => {
    if (tab === "done" && task.completedAt) {
      const date = new Date(task.completedAt);
      return Number.isNaN(date.getTime()) ? "" : shortDay(dateInZone(date, timeZone));
    }
    return task.deadline ? shortDay(task.deadline.slice(0, 10)) : "";
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.spread}>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          disabled={weeksBack >= REVIEW_MAX_WEEKS_BACK}
          onPress={() => {
            setWeeksBack((current) => Math.min(REVIEW_MAX_WEEKS_BACK, current + 1));
            setShowAll(false);
          }}
          style={[styles.iconButton, weeksBack >= REVIEW_MAX_WEEKS_BACK && { opacity: 0.3 }]}
        >
          <ChevronLeft size={18} color={colors.foreground} />
        </AnimatedPressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.rowTitleFixed}>
            {shortDay(review.from)} – {shortDay(review.to)}
          </Text>
          <Text style={styles.tiny}>{weekLabel}</Text>
        </View>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          disabled={weeksBack <= 0}
          onPress={() => {
            setWeeksBack((current) => Math.max(0, current - 1));
            setShowAll(false);
          }}
          style={[styles.iconButton, weeksBack <= 0 && { opacity: 0.3 }]}
        >
          <ChevronRight size={18} color={colors.foreground} />
        </AnimatedPressable>
      </View>

      <View style={styles.tiles} accessibilityRole="tablist">
        {REVIEW_TABS.map((entry) => {
          const selected = tab === entry.key;
          const count = review[entry.key].length;
          return (
            <AnimatedPressable
              key={entry.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${entry.label}: ${count}`}
              onPress={() => {
                setTab(entry.key);
                setShowAll(false);
              }}
              wrapStyle={{ flex: 1 }}
              style={[styles.tile, selected && styles.tileOn]}
            >
              <Text style={[styles.big, entry.key === "slipped" && count > 0 && { color: colors.destructive }]}>{count}</Text>
              <Text style={[styles.small, selected && { color: colors.accentForeground, fontWeight: "600" }]} numberOfLines={1}>
                {entry.label}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <View>
        {list.length === 0 ? (
          <Text style={styles.muted}>{REVIEW_TABS.find((entry) => entry.key === tab)?.empty}</Text>
        ) : (
          shown.map((task) => (
            <AnimatedPressable key={task.id} accessibilityRole="button" onPress={() => onOpenTask(task.id)} style={styles.listRow}>
              <Text style={[styles.rowTitle, tab === "done" && styles.doneText]} numberOfLines={1}>
                {task.name}
              </Text>
              <Text style={[styles.small, tab !== "done" && { color: colors.destructive }]}>{dayOf(task)}</Text>
            </AnimatedPressable>
          ))
        )}
        {list.length > REVIEW_LIST ? (
          <Text style={styles.link} onPress={() => setShowAll((current) => !current)}>
            {showAll ? "Show less" : `Show all ${list.length}`}
          </Text>
        ) : null}
      </View>

      <AutosaveText
        key={review.from}
        text={note}
        maxLength={4000}
        label={`Notes for the week of ${shortDay(review.from)}`}
        placeholder="Notes for this week"
        onChange={(text) => onSettings((current) => ({ notes: setReviewNote(current.notes as Record<string, unknown> | undefined, review.from, text) }))}
      />
    </View>
  );
}

/* Inbox zero */

export function InboxZeroCard({ inbox, today, onOpenTask }: { inbox: Task[]; today: string; onOpenTask: (id: string) => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const save = useSaveTask();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const items = useMemo(
    () => inbox.filter((task) => !task.completedAt && !cleared.includes(task.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [inbox, cleared],
  );
  const queue = items.filter((task) => !skipped.includes(task.id));
  const current = queue[0] ?? items[0] ?? null;

  const skip = () => {
    if (!current) return;
    // Past the last one, start over from the oldest.
    setSkipped((list) => (queue.length <= 1 ? [] : [...list, current.id]));
  };

  const done = (task: Task) => {
    setCleared((list) => [...list, task.id]);
    // The tasks prefix covers the Inbox list too, and drops the item the save cached into the task list.
    const refresh = () => void client.invalidateQueries({ queryKey: keys.tasks });
    save.mutate(
      { id: task.id, data: { completedAt: new Date().toISOString() } },
      {
        onSuccess: () => {
          refresh();
          showUndoToast(`Done: “${task.name}”`, () =>
            save.mutate(
              { id: task.id, data: { completedAt: "" } },
              {
                onSuccess: () => {
                  setCleared((list) => list.filter((id) => id !== task.id));
                  refresh();
                },
                onError: (error) => toastError(error, "Could not reopen the item"),
              },
            ),
          );
        },
        onError: (error) => {
          setCleared((list) => list.filter((id) => id !== task.id));
          toastError(error, "Could not finish the item");
        },
      },
    );
  };

  const inboxLink = (
    <AnimatedPressable accessibilityRole="link" onPress={() => router.push("/(app)/inbox")} style={styles.inline} wrapStyle={{ alignSelf: "center" }}>
      <Text style={styles.link}>Go to Inbox</Text>
      <ArrowRight size={13} color={colors.primary} />
    </AnimatedPressable>
  );

  if (!current) {
    return (
      <View style={styles.zero}>
        <View style={styles.zeroBadge}>
          <Check size={22} color={colors.success} strokeWidth={3} />
        </View>
        <Text style={styles.zeroTitle}>Inbox zero</Text>
        <Text style={[styles.muted, { textAlign: "center" }]}>Nothing waiting. Everything you captured has a home.</Text>
        {inboxLink}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>
        <Text style={styles.huge}>{items.length}</Text> in Inbox
      </Text>
      <View style={styles.oldest}>
        <Text style={styles.label}>{current.id === items[0]?.id ? "Oldest" : "Next"}</Text>
        <Text style={styles.oldestTitle} numberOfLines={3}>
          {current.name}
        </Text>
        <Text style={styles.small}>captured {capturedLabel(current.createdAt, today)}</Text>
      </View>
      <View style={styles.actions}>
        <AnimatedPressable accessibilityRole="button" onPress={() => onOpenTask(current.id)} wrapStyle={{ flex: 1 }} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Open</Text>
        </AnimatedPressable>
        <AnimatedPressable accessibilityRole="button" onPress={() => done(current)} wrapStyle={{ flex: 1 }} style={styles.primaryButton}>
          <Check size={15} color={colors.primaryForeground} />
          <Text style={styles.primaryText}>Done</Text>
        </AnimatedPressable>
        <AnimatedPressable
          accessibilityRole="button"
          disabled={items.length <= 1}
          onPress={skip}
          wrapStyle={{ flex: 1 }}
          style={[styles.secondaryButton, items.length <= 1 && { opacity: 0.4 }]}
        >
          <Text style={styles.secondaryText}>Skip</Text>
        </AnimatedPressable>
      </View>
      {inboxLink}
    </View>
  );
}

// Re-exported so the dashboard imports every new card from one place.
export { ClockCard, HabitsCard, JournalCard } from "./toolCards";

const styles = createThemedStyleSheet((colors) => ({
  spread: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 13 },
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  tiny: { color: colors.mutedForeground, fontSize: 10 },
  strong: { color: colors.foreground, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  big: { color: colors.foreground, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  huge: { color: colors.foreground, fontSize: 34, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600", paddingVertical: 6 },
  centerText: { textAlign: "center", fontSize: 14 },
  rowTitle: { flex: 1, color: colors.foreground, fontSize: 14 },
  rowTitleFixed: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  doneText: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  iconButton: { padding: 6, borderRadius: 8 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkEmpty: { borderStyle: "dashed", borderColor: colors.border },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  searchInput: { flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 10 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 },
  agendaBar: { width: 2, height: 16, borderRadius: 1 },
  miniChart: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 6 },
  miniColumn: { alignItems: "stretch", gap: 4 },
  miniTrack: { height: 56, justifyContent: "flex-end" },
  nowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  nextTitle: { color: colors.foreground, fontSize: 19, fontWeight: "700" },
  goalRow: { alignItems: "center" },
  cornerButton: { position: "absolute", top: 0, right: 0 },
  ringCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  panel: { gap: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 12 },
  stepButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 2 },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accentForeground },
  zero: { alignItems: "center", gap: 6, paddingVertical: 12 },
  zeroBadge: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  zeroTitle: { color: colors.foreground, fontSize: 19, fontWeight: "700" },
  oldest: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 12, gap: 4 },
  oldestTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "600" },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
}));
