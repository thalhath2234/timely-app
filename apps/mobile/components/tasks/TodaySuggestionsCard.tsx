import { useState } from "react";
import { Text, View } from "react-native";
import { CalendarPlus, Sparkles, Star, Target, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { SectionLabel } from "../ui/primitives";
import { useAddBlock, useDecisionFeedback, useSetTodayFocus, useTodaySuggestionsQuery } from "../../lib/hooks";
import { deviceTimezone, formatDuration } from "../../lib/format";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { EffortKind } from "../../lib/api/decisions";

const EFFORT: Record<EffortKind, string> = { deep: "Deep focus", admin: "Admin", creative: "Creative", routine: "Routine" };

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The free gap's start, or the next five minutes when it has already begun
 * (suggestions are fetched ahead of the click). */
function gapStart(iso: string) {
  const step = 5 * 60_000;
  return new Date(Math.max(new Date(iso).getTime(), Math.ceil(Date.now() / step) * step));
}

/** Smart suggestions on Today (phone): Work worth focusing on today, tagged
 * with the goal it moves forward, and the best task for the next free gap.
 * Goal counts live in the Habits and goals card. Renders nothing while
 * suggestions are off. */
export default function TodaySuggestionsCard({
  date,
  version,
  slotsLeft,
  onOpenTask,
}: {
  date: string;
  version: string;
  slotsLeft: number;
  onOpenTask: (id: string) => void;
}) {
  const { data } = useTodaySuggestionsQuery(deviceTimezone(), version);
  const setFocus = useSetTodayFocus();
  const addBlock = useAddBlock();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  if (!data?.available) return null;

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const accept = () => {
    if (data.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };
  const toast = (message: string) => useToastStore.getState().show(message);
  const focus = (data.focus ?? []).filter((pick) => !hidden.has(`focus:${pick.taskId}`));
  const gap = data.gap?.task && !hidden.has(`gap:${data.gap.task.id}`) ? data.gap : undefined;
  if (!focus.length && !gap && !data.error) return null;

  const dismiss = (key: string) => (
    <AnimatedPressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => hide(key)} style={styles.dismiss} hitSlop={8}>
      <X size={14} color={colors.mutedForeground} />
    </AnimatedPressable>
  );

  return (
    <View style={styles.card} testID="today-suggestions">
      <View style={styles.header}>
        <Sparkles size={16} color={colors.primary} />
        <SectionLabel>Suggestions</SectionLabel>
      </View>
      {data.error ? <Text style={styles.meta}>{data.error}</Text> : null}
      {focus.length ? <Text style={styles.label}>Worth focusing on today</Text> : null}
      {focus.map((pick) => {
        const tags = [
          ...pick.reasons.filter((reason) => reason !== "open work" && reason !== "unscheduled"),
          ...(pick.effortKind ? [EFFORT[pick.effortKind]] : []),
        ];
        return (
          <View key={pick.taskId} style={styles.row}>
            <AnimatedPressable style={{ flex: 1 }} onPress={() => onOpenTask(pick.taskId)}>
              <Text style={styles.title} numberOfLines={1}>{pick.name}</Text>
              {tags.length ? <Text style={styles.meta} numberOfLines={1}>{tags.join(" · ")}</Text> : null}
              {pick.goal ? (
                <View style={styles.goalRow}>
                  <Target size={12} color={colors.primary} />
                  <Text style={styles.goal} numberOfLines={1}>{pick.goal}</Text>
                </View>
              ) : null}
            </AnimatedPressable>
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${pick.name} to today's focus`}
              disabled={slotsLeft <= 0 || setFocus.isPending}
              onPress={() => {
                accept();
                void setFocus
                  .mutateAsync({ id: pick.taskId, date })
                  .then(() => toast(`Added to Today focus: ${pick.name}`))
                  .catch(() => toast("Could not add it to Today focus"));
                hide(`focus:${pick.taskId}`);
              }}
              style={[styles.button, slotsLeft <= 0 && { opacity: 0.5 }]}
            >
              <Star size={13} color={colors.foreground} />
            </AnimatedPressable>
            {dismiss(`focus:${pick.taskId}`)}
          </View>
        );
      })}
      {gap?.task ? (
        <View style={[styles.row, styles.gap]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.meta}>
              Free {clock(gap.start)}–{clock(gap.end)} ({formatDuration(gap.minutes)})
            </Text>
            <Text style={styles.title} numberOfLines={2}>{gap.task.name} fits here</Text>
          </View>
          <AnimatedPressable
            accessibilityRole="button"
            disabled={addBlock.isPending}
            onPress={() => {
              const task = gap.task!;
              const start = gapStart(gap.start);
              const end = new Date(start.getTime() + task.minutes * 60_000);
              hide(`gap:${task.id}`);
              if (end > new Date(gap.end)) {
                toast("That free time has passed");
                return;
              }
              accept();
              void addBlock
                .mutateAsync({ taskId: task.id, data: { start: start.toISOString(), end: end.toISOString() } })
                .then(() => toast(`Scheduled at ${clock(start.toISOString())}: ${task.name}`))
                .catch(() => toast("Could not schedule it"));
            }}
            style={styles.button}
          >
            <CalendarPlus size={13} color={colors.foreground} />
            <Text style={styles.buttonText}>Schedule</Text>
          </AnimatedPressable>
          {dismiss(`gap:${gap.task.id}`)}
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, marginBottom: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  gap: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 12, padding: 8 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  goal: { color: colors.primary, fontSize: 12 },
  button: { minHeight: 32, flexDirection: "row", gap: 4, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dismiss: { padding: 4 },
}));
