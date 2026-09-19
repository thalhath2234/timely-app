import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { createThemedStyleSheet, radius } from "../../lib/theme";
import AnimatedPressable from "./AnimatedPressable";
import { useSlidingPill } from "./useSlidingPill";

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const { onItemLayout, pillStyle } = useSlidingPill(value);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
        {options.map((opt) => {
          const on = value !== null && opt.value === value;
          return (
            <AnimatedPressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              onLayout={(event) => onItemLayout(opt.value, event)}
              android_ripple={{ color: "transparent", borderless: false }}
              style={styles.item}
            >
              <Text style={[styles.text, on && styles.onText]}>{opt.label}</Text>
            </AnimatedPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    backgroundColor: colors.muted,
    borderRadius: radius,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  pill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: radius - 4,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.ring,
  },
  item: { flex: 1, height: 32, borderRadius: radius - 4, alignItems: "center", justifyContent: "center" },
  text: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  onText: { color: colors.primaryForeground, fontWeight: "700" },
}));
