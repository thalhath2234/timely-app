import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Flag, Flame, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react-native";
import {
  CLOCK_MAX_LAPS,
  HABIT_LIMIT,
  clockElapsed,
  clockEndsAt,
  clockRemaining,
  clockState,
  docPlainText,
  formatStopwatch,
  habitList,
  habitLog,
  habitStreak,
  journalPrompt,
  newCardId,
  toggleHabit,
  upsertJournalSection,
  type ClockState,
  type Habit,
} from "@timely/contract/dashboard";
import { addDaysToDate } from "@timely/contract/workStatus";
import { openDailyDoc } from "../../lib/api/docs";
import { keys, useUpdateDoc } from "../../lib/hooks";
import { fileHref } from "../../lib/fileRoutes";
import {
  cancelPomodoroNotification,
  getNotificationPermission,
  requestNotificationPermission,
  schedulePomodoroNotification,
} from "../../lib/notifications";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { AutosaveText, type SettingsUpdate } from "./cardParts";

/* Habits */

const HABIT_NAME_MAX = 60;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function weekdayLetter(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return WEEKDAY_LETTERS[(new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7];
}

export function HabitsCard({ settings, today, onSettings }: { settings: Record<string, unknown>; today: string; onSettings: SettingsUpdate }) {
  const habits = habitList(settings);
  const log = habitLog(settings);
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDate(today, index - 6));
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Habit | null>(null);
  const [rename, setRename] = useState("");
  const pendingDelete = useRef<Habit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);
  const full = habits.length >= HABIT_LIMIT;

  const add = () => {
    const name = draft.trim().slice(0, HABIT_NAME_MAX);
    if (!name || full) return;
    const id = newCardId().replace(/^card_/, "habit_");
    onSettings((current) => {
      const list = habitList(current);
      return list.length >= HABIT_LIMIT ? {} : { habits: [...list, { id, name }] };
    });
    setDraft("");
  };

  const toggle = (habitId: string, day: string) => onSettings((current) => ({ log: toggleHabit(habitLog(current), habitId, day, today) }));

  const saveRename = () => {
    const habit = editing;
    const name = rename.trim().slice(0, HABIT_NAME_MAX);
    setEditing(null);
    if (!habit || !name || name === habit.name) return;
    onSettings((current) => ({ habits: habitList(current).map((entry) => (entry.id === habit.id ? { ...entry, name } : entry)) }));
  };

  const remove = (habit: Habit) =>
    onSettings((current) => {
      const nextLog: Record<string, string[]> = {};
      for (const [day, ids] of Object.entries(habitLog(current))) {
        const kept = ids.filter((id) => id !== habit.id);
        if (kept.length > 0) nextLog[day] = kept;
      }
      return { habits: habitList(current).filter((entry) => entry.id !== habit.id), log: nextLog };
    });

  const openEdit = (habit: Habit) => {
    setRename(habit.name);
    setEditing(habit);
  };

  return (
    <View style={{ gap: 10 }}>
      {habits.length === 0 ? (
        <Text style={styles.muted}>
          Add something you want to do every day, like “Read 20 pages” or “Walk”. Tap a day to tick it off; each day in a row grows its streak.
        </Text>
      ) : (
        <View>
          <View style={styles.habitRow}>
            <View style={{ flex: 1 }} />
            <View style={styles.dots}>
              {days.map((day) => (
                <Text key={day} style={[styles.dayLetter, day === today && { color: colors.foreground, fontWeight: "700" }]}>
                  {weekdayLetter(day)}
                </Text>
              ))}
            </View>
          </View>
          {habits.map((habit) => {
            const streak = habitStreak(log, habit.id, today);
            return (
              <View key={habit.id} style={styles.habitRow}>
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityHint="Long-press to rename or delete"
                  accessibilityActions={[{ name: "longpress", label: "Rename or delete" }]}
                  onAccessibilityAction={() => openEdit(habit)}
                  onLongPress={() => openEdit(habit)}
                  delayLongPress={400}
                  wrapStyle={{ flex: 1 }}
                  style={{ flex: 1, gap: 2, paddingVertical: 4 }}
                >
                  <Text style={styles.habitName} numberOfLines={1}>
                    {habit.name}
                  </Text>
                  <View style={styles.inline}>
                    <Flame size={12} color={streak > 0 ? colors.warning : colors.mutedForeground} />
                    <Text style={styles.small}>{streak}</Text>
                  </View>
                </AnimatedPressable>
                <View style={styles.dots}>
                  {days.map((day) => {
                    const done = (log[day] ?? []).includes(habit.id);
                    return (
                      <AnimatedPressable
                        key={day}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: done }}
                        accessibilityLabel={`${habit.name} on ${day === today ? "today" : day}`}
                        hitSlop={2}
                        onPress={() => toggle(habit.id, day)}
                        style={[styles.dayDot, done && styles.dayDotOn, day === today && !done && styles.dayDotToday]}
                      >
                        {done ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                      </AnimatedPressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {full ? (
        <Text style={styles.small}>Up to {HABIT_LIMIT} habits. Long-press one to rename or delete it.</Text>
      ) : (
        <View style={styles.addBox}>
          <TextInput
            value={draft}
            onChangeText={(next) => setDraft(next.slice(0, HABIT_NAME_MAX))}
            onSubmitEditing={add}
            returnKeyType="done"
            placeholder="Add habit"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="New habit name"
            selectionColor={colors.primary}
            style={styles.addInput}
          />
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Add habit"
            disabled={!draft.trim()}
            onPress={add}
            style={[styles.addButton, !draft.trim() && { opacity: 0.4 }]}
          >
            <Plus size={16} color={colors.mutedForeground} />
          </AnimatedPressable>
        </View>
      )}

      <BottomSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        onClosed={() => {
          if (pendingDelete.current) setConfirmDelete(pendingDelete.current);
          pendingDelete.current = null;
        }}
        title="Edit habit"
        footer={
          <View style={styles.sheetActions}>
            <AnimatedPressable
              accessibilityRole="button"
              onPress={() => {
                pendingDelete.current = editing;
                setEditing(null);
              }}
              wrapStyle={{ flex: 1 }}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </AnimatedPressable>
            <AnimatedPressable
              accessibilityRole="button"
              disabled={!rename.trim()}
              onPress={saveRename}
              wrapStyle={{ flex: 1 }}
              style={[styles.primaryButton, !rename.trim() && { opacity: 0.4 }]}
            >
              <Text style={styles.primaryText}>Save</Text>
            </AnimatedPressable>
          </View>
        }
      >
        <TextInput
          value={rename}
          onChangeText={(next) => setRename(next.slice(0, HABIT_NAME_MAX))}
          onSubmitEditing={saveRename}
          returnKeyType="done"
          placeholder="Habit name"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Habit name"
          selectionColor={colors.primary}
          style={styles.input}
        />
      </BottomSheet>
      <ConfirmSheet
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this habit?"
        message={confirmDelete ? `“${confirmDelete.name}” and all its ticks are removed.` : undefined}
        onConfirm={() => {
          if (confirmDelete) remove(confirmDelete);
        }}
      />
    </View>
  );
}

/* Stopwatch and timer */

const TIMER_MAX_MINUTES = 600;

async function notificationsAllowed() {
  const permission = await getNotificationPermission();
  if (permission.granted) return true;
  if (!permission.canAskAgain) return false;
  return requestNotificationPermission();
}

export function ClockCard({ cardId, title, settings, onSettings }: { cardId: string; title: string; settings: Record<string, unknown>; onSettings: SettingsUpdate }) {
  const state = clockState(settings);
  const running = state.startedAt !== null;
  const [now, setNow] = useState(() => Date.now());
  const notifyId = `clock-${cardId}`;
  const endsAt = clockEndsAt(state);
  const endsRef = useRef(endsAt);
  const finished = useRef<number | null>(null);

  useEffect(() => {
    endsRef.current = endsAt;
  });

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), state.mode === "stopwatch" ? 100 : 250);
    return () => clearInterval(id);
  }, [running, state.mode]);

  // The end of a running timer rings as a local notification, so it's heard
  // with the app in the background; anything that stops the timer clears it.
  useEffect(() => {
    if (endsAt === null || endsAt <= Date.now()) {
      void cancelPomodoroNotification(notifyId);
      return;
    }
    void schedulePomodoroNotification(notifyId, endsAt, "Timer done", title);
  }, [endsAt, notifyId, title]);

  // Time's up while the card is on screen: settle the state once.
  const remaining = clockRemaining(state, now);
  useEffect(() => {
    if (state.mode !== "timer" || state.startedAt === null || remaining > 0) return;
    if (finished.current === state.startedAt) return;
    finished.current = state.startedAt;
    onSettings({ done: true, startedAt: null, elapsed: state.minutes * 60_000 });
  }, [remaining, state.mode, state.startedAt, state.minutes, onSettings]);

  const write = (next: Partial<ClockState>) => onSettings({ ...next });

  const start = () => {
    const at = Date.now();
    setNow(at);
    const fresh = state.mode === "timer" && state.done;
    write(fresh ? { startedAt: at, elapsed: 0, done: false } : { startedAt: at, done: false });
    if (state.mode !== "timer") return;
    const ends = clockEndsAt({ ...state, startedAt: at, elapsed: fresh ? 0 : state.elapsed });
    // The effect above schedules it when permission is already there; ask now
    // and schedule once it's granted, unless the timer stopped meanwhile.
    void notificationsAllowed()
      .then((granted) => {
        if (granted && ends !== null && endsRef.current === ends) void schedulePomodoroNotification(notifyId, ends, "Timer done", title);
      })
      .catch(() => undefined);
  };
  const pause = () => {
    const at = Date.now();
    setNow(at);
    write({ elapsed: clockElapsed(state, at), startedAt: null });
  };
  const reset = () => write({ startedAt: null, elapsed: 0, laps: [], done: false });
  const lap = () => write({ laps: [...state.laps, clockElapsed(state, Date.now())].slice(-CLOCK_MAX_LAPS) });
  const setMode = (mode: ClockState["mode"]) => {
    if (mode !== state.mode) write({ mode, startedAt: null, elapsed: 0, laps: [], done: false });
  };
  const changeMinutes = (by: number) => {
    const minutes = Math.min(TIMER_MAX_MINUTES, Math.max(1, state.minutes + by));
    if (minutes === state.minutes) return;
    write(state.done ? { minutes, done: false, elapsed: 0 } : { minutes });
  };

  const elapsed = clockElapsed(state, now);
  const startLabel = running ? "Pause" : state.mode === "timer" && state.done ? "Restart" : state.elapsed > 0 ? "Resume" : "Start";
  const laps = state.laps.map((total, index) => ({ index, total, split: total - (state.laps[index - 1] ?? 0) })).reverse();

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["stopwatch", "timer"] as const).map((mode) => (
          <AnimatedPressable
            key={mode}
            accessibilityRole="tab"
            accessibilityState={{ selected: state.mode === mode }}
            onPress={() => setMode(mode)}
            style={[styles.tab, state.mode === mode && styles.tabOn]}
          >
            <Text style={[styles.tabText, state.mode === mode && styles.tabTextOn]}>{mode === "stopwatch" ? "Stopwatch" : "Timer"}</Text>
          </AnimatedPressable>
        ))}
      </View>

      {state.mode === "stopwatch" ? (
        <Text style={styles.clock} accessibilityRole="timer">
          {formatStopwatch(elapsed, true)}
        </Text>
      ) : (
        <View style={styles.timerRow}>
          {!running ? (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel="One minute less"
              disabled={state.minutes <= 1}
              hitSlop={6}
              onPress={() => changeMinutes(-1)}
              style={[styles.step, state.minutes <= 1 && { opacity: 0.35 }]}
            >
              <Minus size={18} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
          <Text style={[styles.clock, state.done && { color: colors.success }]} accessibilityRole="timer">
            {formatStopwatch(clockRemaining(state, now))}
          </Text>
          {!running ? (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel="One minute more"
              disabled={state.minutes >= TIMER_MAX_MINUTES}
              hitSlop={6}
              onPress={() => changeMinutes(1)}
              style={[styles.step, state.minutes >= TIMER_MAX_MINUTES && { opacity: 0.35 }]}
            >
              <Plus size={18} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </View>
      )}
      {state.mode === "timer" ? (
        <Text style={[styles.small, { textAlign: "center" }, state.done && { color: colors.success, fontWeight: "700", fontSize: 14 }]}>
          {state.done ? "Time's up" : `${state.minutes} min timer`}
        </Text>
      ) : null}

      <View style={styles.controls}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Reset" onPress={reset} style={styles.round}>
          <RotateCcw size={18} color={colors.mutedForeground} />
        </AnimatedPressable>
        <AnimatedPressable accessibilityRole="button" onPress={running ? pause : start} style={styles.primaryPill}>
          {running ? <Pause size={16} color={colors.primaryForeground} /> : <Play size={16} color={colors.primaryForeground} />}
          <Text style={styles.primaryText}>{startLabel}</Text>
        </AnimatedPressable>
        {state.mode === "stopwatch" ? (
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Lap"
            disabled={!running}
            onPress={lap}
            style={[styles.round, !running && { opacity: 0.35 }]}
          >
            <Flag size={18} color={colors.mutedForeground} />
          </AnimatedPressable>
        ) : (
          <View style={styles.roundSpacer} />
        )}
      </View>

      {state.mode === "stopwatch" && laps.length > 0 ? (
        <View>
          {laps.map((entry) => (
            <View key={entry.index} style={styles.lapRow}>
              <Text style={[styles.small, { width: 54 }]}>Lap {entry.index + 1}</Text>
              <Text style={[styles.lapValue, { flex: 1 }]}>{formatStopwatch(entry.split, true)}</Text>
              <Text style={styles.small}>{formatStopwatch(entry.total, true)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* Daily journal */

export function JournalCard({ settings, today, onSettings }: { settings: Record<string, unknown>; today: string; onSettings: SettingsUpdate }) {
  const router = useRouter();
  const client = useQueryClient();
  const updateDoc = useUpdateDoc();
  const prompt = journalPrompt(today);
  const sameDay = settings.day === today;
  const text = sameDay && typeof settings.text === "string" ? settings.text : "";
  const savedDocId = sameDay && typeof settings.savedDocId === "string" ? settings.savedDocId : "";
  const savedText = sameDay && typeof settings.savedText === "string" ? settings.savedText : "";
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const saved = Boolean(savedDocId) && draft === savedText;

  const autosave = (next: string) =>
    onSettings((current) =>
      // A new day's answer starts fresh, not linked to yesterday's note.
      current.day === today ? { day: today, text: next } : { day: today, text: next, savedDocId: "", savedText: "" },
    );

  const save = async () => {
    const body = draft;
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const { document } = await openDailyDoc({ date: today });
      const content = upsertJournalSection(document.content, prompt, body);
      await updateDoc.mutateAsync({ id: document.id, data: { content, plainText: docPlainText(content) } });
      void client.invalidateQueries({ queryKey: keys.docs });
      onSettings({ day: today, text: body, savedDocId: document.id, savedText: body });
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save to today's note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.prompt}>{prompt}</Text>
      <AutosaveText
        key={today}
        text={text}
        onChange={autosave}
        onDraft={setDraft}
        maxLength={10_000}
        label="Journal answer"
        placeholder="Write a few lines. It saves as you type."
        style={{ minHeight: 120 }}
      />
      {saved ? (
        <View style={[styles.inline, { justifyContent: "space-between" }]}>
          <View style={styles.inline}>
            <Check size={14} color={colors.success} />
            <Text style={[styles.small, { color: colors.success }]}>Saved to today's note</Text>
          </View>
          <AnimatedPressable accessibilityRole="link" onPress={() => router.push(fileHref(savedDocId))} style={styles.inline}>
            <Text style={styles.link}>Open</Text>
            <ExternalLink size={13} color={colors.primary} />
          </AnimatedPressable>
        </View>
      ) : (
        <AnimatedPressable
          accessibilityRole="button"
          disabled={!draft.trim() || saving}
          onPress={() => void save()}
          style={[styles.primaryButton, (!draft.trim() || saving) && { opacity: 0.4 }]}
        >
          <Text style={styles.primaryText}>{saving ? "Saving…" : savedDocId ? "Update today's note" : "Save to today's note"}</Text>
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  habitRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  habitName: { color: colors.foreground, fontSize: 14 },
  dots: { flexDirection: "row", gap: 4 },
  dayLetter: { width: 22, textAlign: "center", color: colors.mutedForeground, fontSize: 10 },
  dayDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  dayDotOn: { backgroundColor: colors.success, borderColor: colors.success },
  dayDotToday: { borderColor: colors.foreground },
  addBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingLeft: 12,
  },
  addInput: { flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 10 },
  addButton: { padding: 10 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    color: colors.foreground,
    fontSize: 15,
  },
  sheetActions: { flexDirection: "row", gap: 10 },
  deleteButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.destructive, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.destructive, fontSize: 15, fontWeight: "600" },
  primaryButton: { minHeight: 42, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "600" },
  tabs: { flexDirection: "row", alignItems: "center", gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  tabOn: { backgroundColor: colors.accent },
  tabText: { color: colors.mutedForeground, fontSize: 13 },
  tabTextOn: { color: colors.accentForeground, fontWeight: "600" },
  clock: { color: colors.foreground, fontSize: 42, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "center" },
  timerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 },
  step: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 },
  round: { padding: 10, borderRadius: 22 },
  roundSpacer: { width: 38, height: 38 },
  primaryPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: colors.primary },
  lapRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border },
  lapValue: { color: colors.foreground, fontSize: 14, fontVariant: ["tabular-nums"] },
  prompt: { color: colors.foreground, fontSize: 15, fontStyle: "italic", lineHeight: 21 },
}));
