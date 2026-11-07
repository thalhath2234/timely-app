import { View } from "react-native";
import { BOT_LIMITS } from "@timely/contract/bots";
import { colors } from "../../lib/theme";

/** Strikes toward the self-pause, one segment each (10 px wide on a phone card). */
export function StrikeMeter({ strikes, max = BOT_LIMITS.maxStrikes, segment = 10 }: { strikes: number; max?: number; segment?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${Math.min(strikes, max)} of ${max} strikes`}
      style={{ flexDirection: "row", gap: 3, flexShrink: 0 }}
    >
      {Array.from({ length: max }, (_, index) => (
        <View
          key={index}
          style={{ width: segment, height: 4, borderRadius: 2, backgroundColor: index < strikes ? colors.destructive : colors.muted }}
        />
      ))}
    </View>
  );
}
