import { Text, View } from "react-native";
import { colors, createThemedStyleSheet, getThemeMode } from "../../lib/theme";
import { withAlpha } from "./tone";

/** The warning wash: lighter in light theme, so warning text on it keeps 4.5:1. */
const warningWash = () => withAlpha(colors.warning, getThemeMode() === "dark" ? 0.16 : 0.08);

/** A small rounded tag on a card: "New alert", "Your OK", "Later". */
export function Pill({ children, tone = "default" }: { children: string; tone?: "default" | "primary" | "warning" }) {
  const wash = tone === "primary" ? withAlpha(colors.primary, 0.14) : tone === "warning" ? warningWash() : colors.muted;
  const ink = tone === "primary" ? colors.primary : tone === "warning" ? colors.warningText : colors.mutedForeground;
  return (
    <View style={[styles.pill, { backgroundColor: wash }]}>
      <Text numberOfLines={1} style={[styles.pillText, { color: ink }]}>
        {children}
      </Text>
    </View>
  );
}

/** A section's count beside its label; `attn` is Needs you's warning wash. */
export function CountPill({ count, tone = "default" }: { count: number; tone?: "default" | "attn" }) {
  const attn = tone === "attn";
  return (
    <View style={[styles.count, { backgroundColor: attn ? warningWash() : colors.muted }]}>
      <Text style={[styles.countText, { color: attn ? colors.warningText : colors.mutedForeground }]}>{count}</Text>
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  pill: { height: 20, borderRadius: 999, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pillText: { fontSize: 11, fontWeight: "500" },
  count: { height: 18, minWidth: 18, borderRadius: 999, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
}));
