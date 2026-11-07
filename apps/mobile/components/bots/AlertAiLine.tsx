import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { alertAi, alsoSeenLine, sharedLine, type AlertBrief } from "@timely/contract/bots";
import { createThemedStyleSheet } from "../../lib/theme";
import { Pill } from "./Pill";

type AiAlert = Pick<AlertBrief, "aiState" | "aiWhy" | "held" | "alsoSeenBy" | "sharedWith"> & Partial<Pick<AlertBrief, "kind">>;

/**
 * What the AI judge did with an alert, and who else saw the same thing, as
 * on the web. `compact` (the Needs you card) is one muted line for the judge
 * and one for "Also seen by", each kept to a line, with no pill. `full` (the
 * open bot's Latest alert) adds the "Not checked by AI" pill and lets the
 * lines wrap; a held shared alert says which alert already told the person.
 * Renders nothing on a rules-only alert seen by no other bot.
 */
export function AlertAiLine({ alert, variant, style }: { alert: AiAlert; variant: "compact" | "full"; style?: StyleProp<ViewStyle> }) {
  const ai = alertAi(alert);
  const seen = alsoSeenLine(alert);
  const shared = sharedLine(alert);

  if (variant === "compact") {
    if (!ai.short && !seen) return null;
    return (
      <View style={[styles.compact, style]}>
        {ai.short ? (
          <Text numberOfLines={1} style={styles.line} accessibilityLabel={ai.line ?? ai.short}>
            {ai.short}
          </Text>
        ) : null}
        {seen ? (
          <Text numberOfLines={1} style={styles.line}>
            {seen}
          </Text>
        ) : null}
      </View>
    );
  }

  // "Held back by AI" is the eyebrow of a held alert, so its line keeps only the why.
  const line = alert.held === "judged" && ai.line ? ai.line.replace(/^Held back by AI:?\s*/, "") : ai.line;
  if (!ai.pill && !line && !seen && !shared) return null;
  return (
    <View style={[styles.full, style]}>
      {ai.pill ? (
        <View style={styles.pillRow}>
          <Pill tone="warning">{ai.pill}</Pill>
        </View>
      ) : null}
      {line ? <Text style={styles.line}>{line}</Text> : null}
      {shared ? <Text style={styles.line}>{shared}</Text> : null}
      {seen ? <Text style={styles.line}>{seen}</Text> : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  compact: { gap: 2, minWidth: 0 },
  full: { gap: 4, minWidth: 0 },
  pillRow: { flexDirection: "row" },
  line: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
}));
