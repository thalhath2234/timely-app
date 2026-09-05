import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../lib/theme";

export default function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.wrap}>
      <Icon size={28} color={colors.mutedForeground} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingHorizontal: 28, paddingVertical: 48, gap: 8 },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  desc: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", lineHeight: 18 },
});
