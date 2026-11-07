import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Check, Clock, Lightbulb } from "lucide-react-native";
import { fixAction, fixButtons, fixCopy, type BotView } from "@timely/contract/bots";
import { Button } from "../ui/primitives";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { withAlpha } from "./tone";
import type { BotActions } from "./useBotActions";

/** Whether a bot shows its suggested change: a rules-only bot that is on and not broken. */
export const suggests = (bot: BotView) => !!bot.suggestion && fixAction(bot) === "apply_suggestion";

/**
 * Apply ("Raise to 8%") and Not now on a suggested change: the Needs you
 * card's buttons and the open bot's.
 */
export function SuggestionButtons({ bot, actions, style }: { bot: BotView; actions: BotActions; style?: StyleProp<ViewStyle> }) {
  const { primary, secondary } = fixButtons(bot);
  const busy = actions.busy(bot);
  return (
    <View style={[styles.buttons, style]}>
      {/* Apply stretches; Not now takes only its label's width. */}
      <View style={styles.grow}>
        <Button
          label={primary.label}
          size="sm"
          stretch
          loading={busy === "apply_suggestion"}
          disabled={busy === "dismiss_suggestion"}
          icon={<Check size={16} color={colors.primaryForeground} />}
          onPress={() => actions.act(bot, primary.action)}
        />
      </View>
      <Button
        label={secondary.label}
        variant="outline"
        size="sm"
        loading={busy === "dismiss_suggestion"}
        disabled={busy === "apply_suggestion"}
        icon={<Clock size={16} color={colors.foreground} />}
        onPress={() => actions.act(bot, secondary.action)}
      />
    </View>
  );
}

/**
 * "Suggested change" on an open bot, after three Not useful alerts in a row
 * on a rules-only bot: the change in words, Apply and Not now, the same as
 * its Needs you card and the web's rail.
 */
export function SuggestionCard({ bot, actions }: { bot: BotView; actions: BotActions }) {
  const copy = fixCopy(bot);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Lightbulb size={16} color={colors.warningText} />
        <Text style={styles.eyebrow}>Suggested change</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.meta}>{copy.meta}</Text>
      </View>
      <SuggestionButtons bot={bot} actions={actions} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(colors.warning, 0.45),
    backgroundColor: colors.card,
    padding: 16,
    gap: 10,
    marginTop: 4,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Quieter than the change itself, which is what the card asks about.
  eyebrow: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  copy: { gap: 2 },
  title: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  buttons: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
}));
