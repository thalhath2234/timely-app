import { useEffect, useRef } from "react";
import { type LayoutChangeEvent } from "react-native";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { springSoft } from "../../lib/motion";

export function useSlidingPill(activeKey: string | null | undefined) {
  const reduceMotion = useReducedMotion();
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const ready = useSharedValue(0);

  function movePill(x: number, width: number, animate: boolean) {
    if (animate && ready.value && !reduceMotion) {
      pillX.value = withSpring(x, springSoft);
      pillW.value = withSpring(width, springSoft);
      return;
    }
    pillX.value = x;
    pillW.value = width;
    ready.value = 1;
  }

  function onItemLayout(key: string, event: LayoutChangeEvent) {
    const { x, width } = event.nativeEvent.layout;
    layouts.current[key] = { x, width };
    if (key === activeKey) movePill(x, width, ready.value === 1);
  }

  useEffect(() => {
    if (!activeKey) {
      pillW.value = reduceMotion || !ready.value ? 0 : withSpring(0, springSoft);
      return;
    }
    const layout = layouts.current[activeKey];
    if (!layout) return;
    movePill(layout.x, layout.width, true);
  }, [activeKey, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillW.value,
    opacity: pillW.value > 0 ? 1 : 0,
  }));

  return { onItemLayout, pillStyle };
}
