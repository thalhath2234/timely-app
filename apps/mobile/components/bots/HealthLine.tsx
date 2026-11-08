import { Text, View } from "react-native";
import { healthLine, type BotView, type HealthTone } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { withAlpha } from "./tone";

const dot = (tone: HealthTone) => {
  switch (tone) {
    case "ok":
      return colors.success;
    case "warn":
      return colors.warning;
    case "bad":
      return colors.destructive;
    case "primary":
      return colors.primary;
    default:
      return withAlpha(colors.mutedForeground, 0.6);
  }
};

/**
 * A card's health: a 6 px tone dot, the word in the foreground and the time
 * muted ("Working · 12 min ago", "Snoozed until Mon 09:00").
 */
export function HealthLine({ bot, now }: { bot: BotView; now: Date }) {
  const h = healthLine(bot, now);
  const rest = h.time ? (h.time.startsWith("until ") ? ` ${h.time}` : ` · ${h.time}`) : "";
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: dot(h.tone) }]} />
      <Text numberOfLines={1} style={styles.text}>
        <Text style={styles.word}>{h.word}</Text>
        {rest}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { flexShrink: 1, color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  word: { color: colors.foreground, fontWeight: "500" },
}));
