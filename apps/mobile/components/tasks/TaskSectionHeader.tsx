import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { createThemedStyleSheet } from "../../lib/theme";

export default function TaskSectionHeader({
  icon,
  title,
  subtitle,
  badge,
  badgeTone = "primary",
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: "primary" | "success" | "muted";
}) {
  return (
    <View style={styles.row}>
      <View style={styles.icon}>{icon}</View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={[styles.badge, badgeTone === "success" && styles.badgeSuccess, badgeTone === "muted" && styles.badgeMuted]}>
          <Text style={[styles.badgeText, badgeTone === "success" && styles.badgeTextSuccess]}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, minWidth: 0 },
  icon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  copy: { flex: 1, minWidth: 0, paddingTop: 1 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  subtitle: { color: colors.mutedForeground, fontSize: 11, lineHeight: 15, marginTop: 1 },
  badge: { maxWidth: 108, minHeight: 28, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", flexShrink: 1 },
  badgeSuccess: { backgroundColor: `${colors.success}20` },
  badgeMuted: { backgroundColor: colors.muted },
  badgeText: { color: colors.accentForeground, fontSize: 10, lineHeight: 13, fontWeight: "800", textAlign: "center" },
  badgeTextSuccess: { color: colors.success },
}));
