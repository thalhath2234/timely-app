import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((opt) => {
        const on = value !== null && opt.value === value;
        return (
          <Pressable key={opt.value} onPress={() => onChange(opt.value)} style={[styles.item, on && styles.on]}>
            <Text style={[styles.text, on && styles.onText]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    flexDirection: "row",
    backgroundColor: colors.muted,
    borderRadius: 12,
    padding: 3,
  },
  item: { flex: 1, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.card },
  text: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  onText: { color: colors.foreground },
}));
