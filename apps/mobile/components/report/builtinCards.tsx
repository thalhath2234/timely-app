import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, CornerDownLeft, Inbox, Target } from "lucide-react-native";
import {
  MATRIX_LABELS,
  completionStreak,
  completionsByDay,
  daysUntil,
  priorityMatrix,
  shortDay,
  timeProgress,
  weekStart,
  workdayWindow,
  type MatrixQuadrant,
} from "@timely/contract/dashboard";
import { addDaysToDate, todayInZone } from "@timely/contract/workStatus";
import type { CalendarItem, Task, TodayResponse, WorkingHours } from "../../lib/types";
import { useCaptureInbox } from "../../lib/hooks";
import { heatColor, seriesColor } from "../../lib/dashboard";
import { formatTime } from "../../lib/format";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import DateTimeSheet from "../ui/DateTimeSheet";
import { Meter } from "./charts";

/* Today */

export function TodayCard({
  today,
  loading,
  now,
  onOpenTask,
  onOpenItem,
}: {
  today: TodayResponse | undefined;
  loading: boolean;
  now: Date;
  onOpenTask: (id: string) => void;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const router = useRouter();
  if (loading && !today) return <Muted text="Loading today…" />;
  if (!today) return <Muted text="Today isn't available right now." />;

  const doneIds = new Set(today.completedToday.map((task) => task.id));
  const planned = new Set<string>(doneIds);
  for (const item of today.items) {
    if ((item.kind === "task" || item.kind === "taskOccurrence") && item.taskId && !item.reminder) planned.add(item.taskId);
  }
  for (const task of today.todayFocus) planned.add(task.id);
  const upNext = today.items
    .filter((item) => new Date(item.end).getTime() >= now.getTime() && !item.completedAt)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);
  const focusing = today.focusing ?? today.pausedFocus;

  return (
    <View style={{ gap: 12 }}>
      <View>
        <View style={styles.spread}>
          <Text style={styles.muted}>
            <Text style={styles.strong}>{doneIds.size}</Text> of {planned.size} done
          </Text>
          {today.overdue.length > 0 ? (
            <Text style={[styles.small, { color: colors.destructive }]} onPress={() => router.push("/(app)/today")}>
              {today.overdue.length} overdue
            </Text>
          ) : null}
        </View>
        <Meter value={planned.size ? doneIds.size / planned.size : 0} color={colors.success} />
      </View>

      {focusing ? (
        <AnimatedPressable accessibilityRole="button" onPress={() => onOpenTask(focusing.id)} style={styles.focusRow}>
          <View style={[styles.dot, { backgroundColor: today.focusing ? colors.primary : colors.mutedForeground }]} />
          <Text style={styles.rowTitle} numberOfLines={1}>
            {focusing.name}
          </Text>
          <Text style={styles.small}>{today.focusing ? "Focusing" : "Paused"}</Text>
        </AnimatedPressable>
      ) : null}

      <View>
        <Text style={styles.label}>Up next</Text>
        {upNext.length === 0 ? (
          <Text style={styles.muted}>Nothing else on the calendar today.</Text>
        ) : (
          upNext.map((item) => (
            <AnimatedPressable
              key={`${item.id}-${item.blockId ?? ""}-${item.start}`}
              accessibilityRole="button"
              onPress={() => onOpenItem(item)}
              style={styles.agendaRow}
            >
              <Text style={[styles.small, { width: 58 }]}>{item.allDay ? "All day" : formatTime(item.start)}</Text>
              <View style={[styles.agendaBar, { backgroundColor: item.color ?? (item.kind.startsWith("event") ? seriesColor(1) : colors.primary) }]} />
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {new Date(item.start).getTime() <= now.getTime() ? <Text style={[styles.small, { color: colors.primary }]}>NOW</Text> : null}
            </AnimatedPressable>
          ))
        )}
      </View>
    </View>
  );
}

/* Quick capture */

export function QuickCaptureCard({ inboxCount }: { inboxCount: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const capture = useCaptureInbox();
  const submit = () => {
    const name = text.trim();
    if (!name || capture.isPending) return;
    capture.mutate(name, {
      onSuccess: () => {
        setText("");
        useToastStore.getState().show("Added to Inbox");
      },
      onError: (error) => useToastStore.getState().show(error instanceof Error ? error.message : "Could not add to Inbox"),
    });
  };
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.captureBox}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="done"
          placeholder="Capture a thought, task or idea…"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Capture to Inbox"
          selectionColor={colors.primary}
          style={styles.captureInput}
        />
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Add to Inbox"
          disabled={!text.trim() || capture.isPending}
          onPress={submit}
          style={[styles.captureButton, (!text.trim() || capture.isPending) && { opacity: 0.4 }]}
        >
          <CornerDownLeft size={16} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>
      <AnimatedPressable accessibilityRole="link" onPress={() => router.push("/(app)/inbox")} style={styles.inline}>
        <Inbox size={14} color={colors.mutedForeground} />
        <Text style={styles.small}>{inboxCount === 0 ? "Inbox is empty" : `${inboxCount} waiting in Inbox`}</Text>
      </AnimatedPressable>
    </View>
  );
}

/* Notes */

export function NotesCard({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [value, setValue] = useState(text);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Another device's edit shows up unless this one is mid-typing.
  useEffect(() => {
    if (!focused.current) setValue(text);
  }, [text]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <TextInput
      value={value}
      multiline
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current !== null) clearTimeout(timer.current);
        if (value !== text) onChange(value);
      }}
      onChangeText={(next) => {
        const trimmed = next.slice(0, 20_000);
        setValue(trimmed);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(trimmed), 500);
      }}
      placeholder="Jot something down. It saves as you type."
      placeholderTextColor={colors.mutedForeground}
      accessibilityLabel="Scratchpad"
      selectionColor={colors.primary}
      style={styles.notes}
    />
  );
}

/* Streak heatmap */

function heatLevel(count: number, max: number) {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const share = count / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

export function StreakCard({ tasks, timeZone }: { tasks: Task[]; timeZone?: string }) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ day: string; count: number } | null>(null);
  const today = todayInZone(timeZone);
  const counts = useMemo(() => completionsByDay(tasks, timeZone), [tasks, timeZone]);
  const streak = useMemo(() => completionStreak(counts, today), [counts, today]);

  const gap = 3;
  const cell = 14;
  const weeks = Math.max(4, Math.min(26, Math.floor((width + gap) / (cell + gap))));
  const firstWeek = addDaysToDate(weekStart(today), -7 * (weeks - 1));
  const columns = Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => addDaysToDate(firstWeek, week * 7 + day)));
  const visible = columns.flat().filter((day) => day <= today);
  const max = Math.max(1, ...visible.map((day) => counts.get(day) ?? 0));
  const totalInView = visible.reduce((sum, day) => sum + (counts.get(day) ?? 0), 0);

  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.inline, { gap: 14 }]}>
        <Text style={styles.muted}>
          <Text style={styles.big}>{streak.current}</Text> day streak
        </Text>
        <Text style={styles.muted}>
          Best <Text style={styles.strong}>{streak.best}</Text>
        </Text>
      </View>
      <Text style={styles.small}>{picked ? `${shortDay(picked.day)}: ${picked.count} done` : `${totalInView} done in ${weeks} weeks · tap a day`}</Text>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ flexDirection: "row", gap }}
        accessibilityLabel={`Tasks completed per day over ${weeks} weeks`}
      >
        {width > 0
          ? columns.map((days) => (
              <View key={days[0]} style={{ gap }}>
                {days.map((day) => {
                  const count = counts.get(day) ?? 0;
                  const future = day > today;
                  return (
                    <AnimatedPressable
                      key={day}
                      disabled={future}
                      onPress={() => setPicked({ day, count })}
                      style={[
                        { width: cell, height: cell, borderRadius: 3, backgroundColor: future ? "transparent" : heatColor(heatLevel(count, max)) },
                        day === today && styles.todayCell,
                      ]}
                    />
                  );
                })}
              </View>
            ))
          : null}
      </View>
      <View style={[styles.inline, { justifyContent: "flex-end" }]}>
        <Text style={styles.tiny}>Less</Text>
        {[0, 1, 2, 3, 4].map((level) => (
          <View key={level} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: heatColor(level) }} />
        ))}
        <Text style={styles.tiny}>More</Text>
      </View>
    </View>
  );
}

/* Day and week progress */

export function DayProgressCard({ now, workingHours, timeZone }: { now: Date; workingHours?: WorkingHours | null; timeZone?: string }) {
  const workday = workdayWindow(workingHours, now);
  const progress = timeProgress(now, workday, timeZone);
  const rows = [
    { label: workday ? `Workday ${workday.start}–${workday.end}` : "Day", value: progress.day, hint: workday ? progress.dayLabel : null },
    { label: "Week", value: progress.week, hint: null },
    { label: "Month", value: progress.month, hint: null },
    { label: "Year", value: progress.year, hint: null },
  ];
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, index) => (
        <View key={row.label}>
          <View style={styles.spread}>
            <Text style={styles.rowTitleFixed}>{row.label}</Text>
            <Text style={styles.small}>
              {row.hint ? `${row.hint} · ` : ""}
              {Math.floor(row.value * 100)}%
            </Text>
          </View>
          <Meter value={row.value} color={index} />
        </View>
      ))}
    </View>
  );
}

/* Priority matrix */

const QUADRANT_TINT: Record<MatrixQuadrant, number> = { do: 7, schedule: 0, quick: 3, later: 8 };

export function MatrixCard({
  tasks,
  timeZone,
  urgentDays,
  onOpenTask,
}: {
  tasks: Task[];
  timeZone?: string;
  urgentDays: number;
  onOpenTask: (id: string) => void;
}) {
  const today = todayInZone(timeZone);
  const matrix = useMemo(() => priorityMatrix(tasks, today, urgentDays), [tasks, today, urgentDays]);
  return (
    <View style={{ gap: 8 }}>
      {(["do", "schedule", "quick", "later"] as const).map((quadrant) => (
        <View key={quadrant} style={styles.quadrant}>
          <View style={styles.inline}>
            <View style={[styles.dot, { backgroundColor: seriesColor(QUADRANT_TINT[quadrant], quadrant === "later") }]} />
            <Text style={styles.quadrantTitle}>{MATRIX_LABELS[quadrant].title}</Text>
            <Text style={[styles.small, { marginLeft: "auto" }]}>{matrix[quadrant].length}</Text>
          </View>
          <Text style={styles.tiny}>{MATRIX_LABELS[quadrant].hint}</Text>
          {matrix[quadrant].slice(0, 5).map((task) => (
            <AnimatedPressable key={task.id} accessibilityRole="button" onPress={() => onOpenTask(task.id)} style={styles.matrixRow}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {task.name}
              </Text>
              {task.deadline ? <Text style={styles.small}>{shortDay(task.deadline.slice(0, 10))}</Text> : null}
            </AnimatedPressable>
          ))}
          {matrix[quadrant].length > 5 ? <Text style={styles.tiny}>+{matrix[quadrant].length - 5} more</Text> : null}
        </View>
      ))}
    </View>
  );
}

/* Countdown */

function dayString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CountdownCard({
  label,
  date,
  timeZone,
  onChange,
}: {
  label: string;
  date: string;
  timeZone?: string;
  onChange: (next: { label?: string; date?: string }) => void;
}) {
  const [editing, setEditing] = useState(!date);
  const [picking, setPicking] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftDate, setDraftDate] = useState(date);
  const days = date ? daysUntil(date, todayInZone(timeZone)) : null;

  if (editing || days === null) {
    return (
      <View style={{ gap: 8 }}>
        <TextInput
          value={draftLabel}
          onChangeText={(next) => setDraftLabel(next.slice(0, 80))}
          placeholder="What are you counting down to?"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Countdown name"
          selectionColor={colors.primary}
          style={styles.input}
        />
        <View style={[styles.inline, { gap: 8 }]}>
          <AnimatedPressable accessibilityRole="button" onPress={() => setPicking(true)} style={[styles.input, { flex: 1, justifyContent: "center" }]}>
            <Text style={draftDate ? styles.rowTitleFixed : styles.muted}>{draftDate ? shortDay(draftDate) : "Pick a date"}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            accessibilityRole="button"
            disabled={!draftDate}
            onPress={() => {
              onChange({ label: draftLabel.trim(), date: draftDate });
              setEditing(false);
            }}
            style={[styles.saveButton, !draftDate && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>Save</Text>
          </AnimatedPressable>
        </View>
        <DateTimeSheet
          open={picking}
          mode="date"
          title="Countdown date"
          clearable={false}
          value={draftDate ? new Date(`${draftDate}T12:00:00`) : null}
          onClose={() => setPicking(false)}
          onChange={(next) => {
            if (next) setDraftDate(dayString(next));
            setPicking(false);
          }}
        />
      </View>
    );
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityHint="Change the date"
      onPress={() => {
        setDraftLabel(label);
        setDraftDate(date);
        setEditing(true);
      }}
    >
      <Text style={styles.muted}>
        <Text style={styles.huge}>{Math.abs(days)}</Text> {Math.abs(days) === 1 ? "day" : "days"}
      </Text>
      <View style={[styles.inline, { marginTop: 6 }]}>
        {days >= 0 ? <Target size={14} color={colors.mutedForeground} /> : <CalendarDays size={14} color={colors.mutedForeground} />}
        <Text style={styles.small}>
          {days === 0 ? "Today" : days > 0 ? "until" : "since"} {label || shortDay(date)} · {shortDay(date)}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

function Muted({ text }: { text: string }) {
  return <Text style={[styles.muted, { textAlign: "center", paddingVertical: 16 }]}>{text}</Text>;
}

const styles = createThemedStyleSheet((colors) => ({
  spread: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 13 },
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  tiny: { color: colors.mutedForeground, fontSize: 10 },
  strong: { color: colors.foreground, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  big: { color: colors.foreground, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  huge: { color: colors.foreground, fontSize: 38, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 },
  rowTitle: { flex: 1, color: colors.foreground, fontSize: 14 },
  rowTitleFixed: { color: colors.foreground, fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  focusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  agendaRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 },
  agendaBar: { width: 2, height: 16, borderRadius: 1 },
  captureBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingLeft: 12,
  },
  captureInput: { flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 10 },
  captureButton: { padding: 10 },
  notes: { minHeight: 110, color: colors.foreground, fontSize: 15, lineHeight: 22, textAlignVertical: "top", padding: 0 },
  todayCell: { borderWidth: 1, borderColor: colors.foreground },
  quadrant: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 10, gap: 2 },
  quadrantTitle: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  matrixRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  input: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    color: colors.foreground,
    fontSize: 14,
  },
  saveButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, justifyContent: "center" },
  saveText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "600" },
}));
