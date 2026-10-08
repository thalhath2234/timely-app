import { useEffect, useMemo, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";
import { Pause, Play, RotateCcw, Settings2, SkipForward, X } from "lucide-react-native";
import { formatClock, initialPomodoro, phaseMinutes, pomodoroSettings, type PomodoroPhase } from "@timely/contract/dashboard";
import { todayInZone } from "@timely/contract/workStatus";
import type { Task } from "../../lib/types";
import { bindPomodoroQueryClient, pomodoroTimeLeft, usePomodoroStore } from "../../lib/pomodoroStore";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Select } from "../ui/primitives";

const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: "Focus", short: "Short break", long: "Long break" };
const RING = 168;
const STROKE = 6;

/** A view onto the app-level timer, so it keeps running after leaving the Report screen. */
export default function PomodoroCard({
  cardId,
  settings: rawSettings,
  onSettings,
  tasks,
  timeZone,
}: {
  cardId: string;
  settings?: Record<string, unknown>;
  onSettings: (next: Record<string, unknown>) => void;
  tasks: Task[];
  timeZone?: string;
}) {
  const settings = useMemo(() => pomodoroSettings(rawSettings), [rawSettings]);
  const client = useQueryClient();
  const stored = usePomodoroStore((store) => store.timers[cardId]);
  const actions = usePomodoroStore.getState();
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    bindPomodoroQueryClient(client);
  }, [client]);

  useEffect(() => {
    usePomodoroStore.getState().sync(cardId, rawSettings, timeZone);
  }, [cardId, rawSettings, timeZone]);

  const timer = stored ?? { ...initialPomodoro(), cardId, settings };
  const running = timer.endsAt !== null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const total = phaseMinutes(timer.phase, settings) * 60_000;
  const remaining = Math.min(pomodoroTimeLeft({ ...timer, settings }, now), total);
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
  const todayCount = timer.history[todayInZone(timeZone)] ?? 0;
  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  const openTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.completedAt && task.kind !== "inbox" && task.kind !== "reminder")
        .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"))
        .slice(0, 100),
    [tasks],
  );

  if (editing) {
    return <PomodoroSettingsForm settings={settings} onClose={() => setEditing(false)} onChange={(next) => onSettings({ ...rawSettings, ...next })} />;
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["focus", "short", "long"] as const).map((phase) => (
          <AnimatedPressable
            key={phase}
            accessibilityRole="tab"
            accessibilityState={{ selected: timer.phase === phase }}
            onPress={() => actions.setPhase(cardId, phase)}
            style={[styles.tab, timer.phase === phase && styles.tabOn]}
          >
            <Text style={[styles.tabText, timer.phase === phase && styles.tabTextOn]}>{PHASE_LABEL[phase]}</Text>
          </AnimatedPressable>
        ))}
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Timer settings" onPress={() => setEditing(true)} style={styles.iconButton} wrapStyle={{ marginLeft: "auto" }}>
          <Settings2 size={16} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>

      <View style={styles.ringWrap}>
        <Svg width={RING} height={RING} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={RING / 2} cy={RING / 2} r={radius} fill="none" stroke={colors.muted} strokeWidth={STROKE} />
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={radius}
            fill="none"
            stroke={timer.phase === "focus" ? colors.primary : colors.success}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </Svg>
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={styles.clock}>{formatClock(remaining)}</Text>
          <Text style={styles.small}>{running ? PHASE_LABEL[timer.phase] : timer.remaining !== null ? "Paused" : "Ready"}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Reset" onPress={() => actions.reset(cardId)} style={styles.round}>
          <RotateCcw size={18} color={colors.mutedForeground} />
        </AnimatedPressable>
        <AnimatedPressable
          accessibilityRole="button"
          onPress={() => {
            setNow(Date.now());
            if (running) actions.pause(cardId);
            else actions.start(cardId);
          }}
          style={styles.primary}
        >
          {running ? <Pause size={16} color={colors.primaryForeground} /> : <Play size={16} color={colors.primaryForeground} />}
          <Text style={styles.primaryText}>{running ? "Pause" : timer.remaining !== null ? "Resume" : "Start"}</Text>
        </AnimatedPressable>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Skip to next phase" onPress={() => actions.skip(cardId)} style={styles.round}>
          <SkipForward size={18} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={`Round ${Math.min(timer.round + 1, settings.rounds)} of ${settings.rounds}`}>
          {Array.from({ length: settings.rounds }, (_, index) => (
            <View key={index} style={[styles.roundDot, { backgroundColor: index < timer.round ? colors.primary : colors.muted }]} />
          ))}
        </View>
        <Text style={styles.small}>
          {todayCount} {todayCount === 1 ? "session" : "sessions"} today
        </Text>
      </View>

      <Select
        value={timer.taskId ?? ""}
        placeholder="Task to track time on"
        onChange={(value) => {
          const task = openTasks.find((entry) => entry.id === value);
          actions.linkTask(cardId, task ? { id: task.id, name: task.name } : null);
        }}
        options={[{ value: "", label: "No task linked" }, ...openTasks.map((task) => ({ value: task.id, label: task.name }))]}
      />
    </View>
  );
}

function PomodoroSettingsForm({
  settings,
  onChange,
  onClose,
}: {
  settings: ReturnType<typeof pomodoroSettings>;
  onChange: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const field = (key: "focus" | "shortBreak" | "longBreak" | "rounds", label: string, max: number, unit: string) => (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.inline}>
        <TextInput
          defaultValue={String(settings[key])}
          keyboardType="number-pad"
          accessibilityLabel={label}
          selectionColor={colors.primary}
          onEndEditing={(event) => {
            const value = Number(event.nativeEvent.text);
            if (Number.isFinite(value) && value >= 1) onChange({ [key]: Math.min(max, Math.round(value)) });
          }}
          style={styles.number}
        />
        <Text style={[styles.small, { width: 28 }]}>{unit}</Text>
      </View>
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.settingRow}>
        <Text style={styles.label}>Timer settings</Text>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={styles.iconButton}>
          <X size={16} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>
      {field("focus", "Focus", 180, "min")}
      {field("shortBreak", "Short break", 60, "min")}
      {field("longBreak", "Long break", 90, "min")}
      {field("rounds", "Rounds before a long break", 12, "")}
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Start the next round automatically</Text>
        <Switch value={settings.autoStart} onValueChange={(value) => onChange({ autoStart: value })} />
      </View>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Sound when a round ends</Text>
        <Switch value={settings.sound} onValueChange={(value) => onChange({ sound: value })} />
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  tabs: { flexDirection: "row", alignItems: "center", gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  tabOn: { backgroundColor: colors.accent },
  tabText: { color: colors.mutedForeground, fontSize: 13 },
  tabTextOn: { color: colors.accentForeground, fontWeight: "600" },
  iconButton: { padding: 6, borderRadius: 8 },
  ringWrap: { alignSelf: "center", width: RING, height: RING },
  ringCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  clock: { color: colors.foreground, fontSize: 38, fontWeight: "700", fontVariant: ["tabular-nums"] },
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  label: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 },
  round: { padding: 10, borderRadius: 22 },
  primary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: colors.primary },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "600" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dots: { flexDirection: "row", gap: 4 },
  roundDot: { width: 7, height: 7, borderRadius: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  settingLabel: { flex: 1, color: colors.foreground, fontSize: 14 },
  number: {
    width: 60,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    textAlign: "right",
    paddingHorizontal: 8,
    fontSize: 14,
  },
}));
