import { useMemo } from "react";
import { Text, View } from "react-native";
import { Lightbulb, Sparkles } from "lucide-react-native";
import { highlightFacts, type DashboardData } from "@timely/contract/dashboard";
import type { HighlightGroup } from "../../lib/api/decisions";
import { useHighlightsQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";

/** Highlights (smart suggestions): what stands out this week, why Work is
 * blocked or left unfinished, and tips the person's own data backs. */
export default function HighlightsCard({
  data,
  now,
  timeZone,
  loading,
  onOpenTask,
}: {
  data: DashboardData;
  now: Date;
  timeZone?: string;
  loading: boolean;
  onOpenTask: (id: string) => void;
}) {
  // Facts move by the hour at most, so the clock is read once per hour.
  const hour = Math.floor(now.getTime() / 3_600_000);
  const facts = useMemo(() => highlightFacts(data, { now: new Date(hour * 3_600_000), timeZone }), [data, hour, timeZone]);
  const query = useHighlightsQuery(facts, !loading);
  const result = query.data;

  if (loading || (query.isLoading && !result)) return <Text style={styles.muted}>Reading your week…</Text>;
  if (query.isError) return <Text style={styles.muted}>Highlights could not load.</Text>;
  if (!result?.available) return <Text style={styles.muted}>Turn on smart suggestions in Settings → Agent to see highlights.</Text>;
  if (!result.highlights.length && !result.blockers.length && !result.missed.length && !result.tips.length) {
    return <Text style={styles.muted}>Nothing stands out this week.</Text>;
  }
  return (
    <View style={{ gap: 10 }} testID="highlights-card">
      {result.highlights.map((fact) => (
        <View key={fact.id} style={styles.line}>
          <Sparkles size={14} color={colors.primary} style={{ marginTop: 2 }} />
          <Text style={styles.text}>{fact.text}</Text>
        </View>
      ))}
      <Groups title="Why work is blocked" groups={result.blockers} onOpenTask={onOpenTask} />
      <Groups title="Why work was left unfinished" groups={result.missed} onOpenTask={onOpenTask} />
      {result.tips.map((tip) => (
        <View key={tip.key} style={styles.line}>
          <Lightbulb size={14} color={colors.warning} style={{ marginTop: 2 }} />
          <Text style={styles.muted}>{tip.text}</Text>
        </View>
      ))}
    </View>
  );
}

function Groups({ title, groups, onOpenTask }: { title: string; groups: HighlightGroup[]; onOpenTask: (id: string) => void }) {
  if (!groups.length) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{title}</Text>
      {groups.slice(0, 3).map((group) => (
        <View key={group.key} style={{ gap: 2 }}>
          <Text style={styles.small}>
            <Text style={styles.strong}>{group.label}</Text> · {group.count}
          </Text>
          <View style={styles.chips}>
            {group.tasks.slice(0, 3).map((task) => (
              <AnimatedPressable key={task.id} onPress={() => onOpenTask(task.id)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText} numberOfLines={1}>
                  {task.name}
                </Text>
              </AnimatedPressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  line: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  text: { flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 19 },
  muted: { flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  small: { color: colors.mutedForeground, fontSize: 12 },
  strong: { color: colors.foreground, fontWeight: "600" },
  label: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { maxWidth: 220, borderRadius: 999, backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: colors.mutedForeground, fontSize: 12 },
}));
