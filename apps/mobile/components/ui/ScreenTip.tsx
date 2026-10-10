import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Lightbulb, X } from "lucide-react-native";
import AnimatedPressable from "./AnimatedPressable";
import { useDecisionFeedback, useDismissTip, useScreenTipQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { TipAction, TipScreen } from "../../lib/api/decisions";

const ACTIONS: Record<TipAction, { label: string; href: Href }> = {
  inbox: { label: "Open Inbox", href: "/(app)/inbox" },
  calendar: { label: "Open Calendar", href: "/(app)/(tabs)/calendar" },
  settings_schedule: { label: "Set hours", href: "/(app)/settings/schedule" },
  settings_workspaces: { label: "Open settings", href: "/(app)/settings/workspaces" },
};

/** The one tip smart suggestions pick for this screen (phone). Dismissed
 * tips never come back; nothing shows while suggestions are off. */
export default function ScreenTip({ screen, style }: { screen: TipScreen; style?: StyleProp<ViewStyle> }) {
  const { data } = useScreenTipQuery(screen);
  const dismiss = useDismissTip();
  const feedback = useDecisionFeedback();
  const router = useRouter();
  const tip = data?.tip;
  if (!data?.available || !tip) return null;
  const action = tip.action ? ACTIONS[tip.action] : undefined;

  return (
    <View style={[styles.card, style]} testID="screen-tip">
      <Lightbulb size={16} color={colors.primary} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.text}>{tip.text}</Text>
        {action ? (
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => {
              if (data.logId) feedback.mutate({ logId: data.logId, accepted: true });
              router.push(action.href);
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </AnimatedPressable>
        ) : null}
      </View>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss tip"
        hitSlop={8}
        onPress={() => dismiss.mutate({ key: tip.key, logId: data.logId })}
        style={styles.dismiss}
      >
        <X size={14} color={colors.mutedForeground} />
      </AnimatedPressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  text: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
  button: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  buttonText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  dismiss: { padding: 2 },
}));
