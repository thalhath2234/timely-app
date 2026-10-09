import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronDown, ChevronUp, Hourglass, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useDecisionFeedback, useKeepStaleTask, useSaveTask, useStaleWorkQuery } from "../../lib/hooks";
import { showUndoToast } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { StaleVerdict } from "../../lib/api/decisions";

const VERDICT: Record<StaleVerdict, string> = {
  actionable: "Still worth doing",
  clarify: "Needs clarifying",
  blocked: "Waiting on something",
  obsolete: "Maybe no longer needed",
};

// Hidden until the app restarts; the web hides it for a week.
let hiddenThisRun = false;

/** Open Work nobody has touched in three weeks, with smart suggestions' read
 * of what each one needs: Keep, Done or open each one. */
export default function StaleWorkCard() {
  const router = useRouter();
  const [hidden, setHidden] = useState(hiddenThisRun);
  const { data } = useStaleWorkQuery(!hidden);
  const keep = useKeepStaleTask();
  const save = useSaveTask();
  const feedback = useDecisionFeedback();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  if (hidden || !data?.available) return null;
  const tasks = data.tasks.filter((task) => !gone.has(task.id));
  if (tasks.length === 0) return null;
  const drop = (id: string) => setGone((prev) => new Set(prev).add(id));
  const answer = (verdict: StaleVerdict | undefined, accepted: boolean) => {
    if (data.logId && verdict) feedback.mutate({ logId: data.logId, accepted });
  };
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View style={styles.card} testID="stale-work">
      <View style={styles.header}>
        <Hourglass size={16} color={colors.mutedForeground} />
        <Pressable style={styles.title} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={styles.titleText}>
            {tasks.length} open task{tasks.length === 1 ? " has" : "s have"} had no activity for three weeks.
          </Text>
          <Text style={styles.review}>{open ? "Hide" : "Review"}</Text>
          <Chevron size={14} color={colors.primary} />
        </Pressable>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Hide"
          hitSlop={8}
          onPress={() => {
            hiddenThisRun = true;
            setHidden(true);
          }}
        >
          <X size={14} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>
      {open
        ? tasks.map((task) => (
            <View key={task.id} style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/(app)/tasks/${task.id}`)}>
                <Text numberOfLines={1} style={styles.name}>{task.name}</Text>
                <Text style={styles.meta}>
                  {task.idleDays} days idle{task.verdict ? ` · ${VERDICT[task.verdict]}` : ""}
                </Text>
              </Pressable>
              <AnimatedPressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => {
                  keep.mutate(task.id);
                  answer(task.verdict, task.verdict === "actionable");
                  drop(task.id);
                }}
              >
                <Text style={styles.buttonText}>Keep</Text>
              </AnimatedPressable>
              <AnimatedPressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => {
                  save.mutate({ id: task.id, data: { completedAt: new Date().toISOString() } });
                  answer(task.verdict, task.verdict === "obsolete");
                  drop(task.id);
                  showUndoToast("Marked done", () => save.mutate({ id: task.id, data: { completedAt: "" } }));
                }}
              >
                <Text style={styles.buttonText}>Done</Text>
              </AnimatedPressable>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, marginTop: 8, marginBottom: 4, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  titleText: { flexShrink: 1, color: colors.foreground, fontSize: 13 },
  review: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
}));
