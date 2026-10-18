import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { createThemedStyleSheet } from "../../lib/theme";

/** The empty-state loops, rendered from the web film kit by `make film-render-loops`. */
export const LOOPS = {
  capture: { source: require("../../assets/loops/capture.webp"), label: "A thought typed into the capture box becomes a task scheduled for Friday" },
  ask: { source: require("../../assets/loops/ask.webp"), label: "A question to the assistant answered with a proposal of four changes, accepted" },
  cards: { source: require("../../assets/loops/cards.webp"), label: "A card dragged from the picker onto the dashboard grid, its number counting up" },
  project: { source: require("../../assets/loops/project.webp"), label: "A project named, its stages appearing, tasks moving to Done as the bar fills" },
  files: { source: require("../../assets/loops/files.webp"), label: "A line written in a doc turned into a task linked back to the doc" },
  schedule: { source: require("../../assets/loops/schedule.webp"), label: "Estimated tasks dropping into free time in deadline order; a meeting lands and one block moves to Friday" },
} as const;

export type LoopId = keyof typeof LOOPS;

/** A four-second film loop (animated WebP, 8:5), still on its first frame when motion is reduced. */
export default function LoopImage({ id, style }: { id: LoopId; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReducedMotion();
  const loop = LOOPS[id];
  return (
    <View style={[styles.box, style]} accessibilityRole="image" accessibilityLabel={loop.label}>
      <Image source={loop.source} style={StyleSheet.absoluteFill} contentFit="cover" autoplay={!reduceMotion} transition={0} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  box: { width: "100%", aspectRatio: 8 / 5, borderRadius: 10, overflow: "hidden", backgroundColor: "#0b0b0f", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
