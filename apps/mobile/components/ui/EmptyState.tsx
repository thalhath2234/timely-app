import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { pageEntering } from "../../lib/motion";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import LoopImage, { type LoopId } from "./LoopImage";

/**
 * Nothing here yet. With `loop`, a card holding a four-second film loop of
 * the thing to do above one line of copy and the action; without one, the
 * centred icon and text.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  compact,
  loop,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  compact?: boolean;
  loop?: LoopId;
  action?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  if (loop) {
    return (
      <Animated.View entering={pageEntering(reduceMotion)} style={styles.card} testID="empty-state">
        <LoopImage id={loop} />
        <View style={styles.copy}>
          <Text style={styles.cardTitle}>{title}</Text>
          {description ? <Text style={styles.cardDesc}>{description}</Text> : null}
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={pageEntering(reduceMotion)} style={[styles.wrap, compact && styles.compact]}>
      <Icon size={compact ? 22 : 28} color={colors.mutedForeground} />
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.desc}>{description}</Text> : null}
    </Animated.View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { alignItems: "center", paddingHorizontal: 28, paddingVertical: 48, gap: 8 },
  compact: { paddingVertical: 16 },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  desc: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", lineHeight: 18 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, padding: 10, gap: 12 },
  copy: { paddingHorizontal: 4, paddingBottom: 4, gap: 4 },
  cardTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  cardDesc: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  action: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
}));
