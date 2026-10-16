import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { controlRadius, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "./AnimatedPressable";
import { useSlidingPill } from "./useSlidingPill";

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  accessibilityLabel,
}: {
  options: { label: string; value: T }[];
  value: T | null;
  onChange: (v: T) => void;
  /** "sm": segments as wide as their words, 28px tall, for the right side of a settings row. */
  size?: "md" | "sm";
  accessibilityLabel?: string;
}) {
  const sm = size === "sm";
  const { onItemLayout, pillStyle } = useSlidingPill(value);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.wrap, sm && styles.wrapSm]}>
      <View style={styles.row}>
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
        {options.map((opt) => {
          const on = value !== null && opt.value === value;
          return (
            <AnimatedPressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(opt.value)}
              onLayout={(event) => onItemLayout(opt.value, event)}
              android_ripple={{ color: "transparent", borderless: false }}
              style={[styles.item, sm && styles.itemSm]}
            >
              <Text style={[styles.text, sm && styles.textSm, on && styles.onText]}>{opt.label}</Text>
            </AnimatedPressable>
          );
        })}
      </View>
    </View>
  );
}

// Same look as the desktop SegmentedControl: a filled track with the active
// segment raised on a card (docs/design-system.md#segmented-control).
const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    backgroundColor: colors.muted,
    borderRadius: controlRadius,
    padding: 3,
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
    borderRadius: controlRadius - 3,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  wrapSm: { padding: 2, alignSelf: "flex-start" },
  itemSm: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", height: 28, paddingHorizontal: 11 },
  textSm: { fontSize: 12.5 },
  item: { flex: 1, height: 32, borderRadius: controlRadius - 3, alignItems: "center", justifyContent: "center" },
  text: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  onText: { color: colors.foreground, fontWeight: "600" },
}));
