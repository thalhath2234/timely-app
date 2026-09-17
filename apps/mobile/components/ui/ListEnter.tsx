import { type ReactNode } from "react";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { listEntering, listLayout } from "../../lib/motion";

export default function ListEnter({
  index = 0,
  children,
}: {
  index?: number;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={listEntering(index, reduceMotion)} layout={listLayout(reduceMotion)}>
      {children}
    </Animated.View>
  );
}
