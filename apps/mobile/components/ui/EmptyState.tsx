import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <Icon size={compact ? 22 : 28} color={colors.mutedForeground} />
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.desc}>{description}</Text> : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { alignItems: "center", paddingHorizontal: 28, paddingVertical: 48, gap: 8 },
  compact: { paddingVertical: 16 },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  desc: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", lineHeight: 18 },
}));
