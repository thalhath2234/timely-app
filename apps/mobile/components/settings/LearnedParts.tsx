import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Lightbulb } from "lucide-react-native";
import { LEARNED_TITLE, type BudgetMeter } from "@timely/contract/agentLearning";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  useLearnedSkillsQuery,
  useLearningSettingsQuery,
  useStagedLearningQuery,
} from "../../lib/hooks";
import { LEARNED_ROUTE, learnedRowMeta } from "../../lib/chat/learning";
import AnimatedPressable from "../ui/AnimatedPressable";
import { ListGroup, ListRow } from "./SettingsList";

/**
 * Settings → Agent → "What Timely learned" (Main.dc.html's row): "14 skills ·
 * About you · 1 waiting", opening Activity, About you, Waiting for you and
 * the switches. Hidden on a server without /agent/learning.
 */
export function LearnedRow({ agent }: { agent: boolean }) {
  const settings = useLearningSettingsQuery();
  // The counts come from the agent: ask only when chats run on it, so Settings never starts it for nothing.
  const ready = !!settings.data && agent;
  const skills = useLearnedSkillsQuery(ready);
  const pending = useStagedLearningQuery(ready);
  const router = useRouter();
  if (!settings.data) return null;
  const waiting = pending.data?.length ?? 0;
  return (
    <ListGroup testID="learned-row">
      <ListRow
        title={LEARNED_TITLE}
        meta={learnedRowMeta(settings.data, skills.data, waiting)}
        leading={<Tile />}
        onPress={() => router.push(LEARNED_ROUTE)}
      />
    </ListGroup>
  );
}

/** The bulb tile of a learning row. */
export function Tile() {
  return (
    <View style={styles.tile}>
      <Lightbulb size={16} color={colors.primary} />
    </View>
  );
}

/** A budget meter as a row: the label, "1,104 of 1,375", and a thin bar under. */
export function MeterRow({ label, meter }: { label: string; meter: BudgetMeter }) {
  const tone = meter.tone === "full" ? colors.destructive : meter.tone === "near" ? colors.warningText : colors.primary;
  return (
    <View style={styles.meter} testID="learned-meter" accessibilityLabel={`${label}: ${meter.text} characters`}>
      <View style={styles.meterHead}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={[styles.meterValue, meter.tone !== "ok" && { color: tone }]}>{meter.text}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(meter.ratio * 100)}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

/** A pressable row whose text wraps to three lines (an About you entry). */
export function TextRow({ text, onPress, testID }: { text: string; onPress?: () => void; testID?: string }) {
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${text}. Edit`}
      onPress={onPress}
      android_ripple={{ color: `${colors.primary}1f` }}
      style={styles.textRow}
    >
      <Text numberOfLines={3} style={styles.textRowText}>
        {text}
      </Text>
    </AnimatedPressable>
  );
}

/** A unified diff or a before/after text, monospace, added lines green and removed ones red. */
export function DiffBlock({ text, testID }: { text: string; testID?: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <View style={styles.diff} testID={testID}>
      {lines.map((line, i) => {
        // file headers come in a ---/+++ pair; a lone "---" is a changed line (a skill's frontmatter)
        const header =
          (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) ||
          (line.startsWith("+++ ") && lines[i - 1]?.startsWith("--- "));
        const added = line.startsWith("+") && !header;
        const removed = line.startsWith("-") && !header;
        return (
          <Text
            key={i}
            selectable
            style={[styles.diffLine, added && { color: colors.successText }, removed && { color: colors.destructive }]}
          >
            {line || " "}
          </Text>
        );
      })}
    </View>
  );
}

/** A titled block in a sheet ("Before", "After"). */
export function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.blockLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** Plain text in a quiet box: a memory entry before or after, or (mono) a skill's whole text. */
export function TextBlock({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <View style={styles.diff}>
      <Text selectable style={mono ? styles.diffLine : styles.textBlock}>
        {text}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${colors.primary}1a`,
    alignItems: "center",
    justifyContent: "center",
  },
  meter: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  meterHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meterLabel: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meterValue: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  textRow: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10 },
  textRowText: { color: colors.foreground, fontSize: 15, lineHeight: 20 },
  diff: { borderRadius: 10, backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 8 },
  diffLine: { color: colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  textBlock: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
  blockLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
}));
