import { type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { springSnappy, springSoft } from "../../lib/motion";

const AnimatedPressableView = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  wrapStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** Tap scale equivalent of web `tapPress` / hover lift. */
export default function AnimatedPressable({
  style,
  wrapStyle,
  children,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressableView
      collapsable={false}
      disabled={disabled}
      style={[wrapStyle, style, animatedStyle]}
      onPressIn={(event) => {
        if (!disabled && !reduceMotion) {
          scale.value = withSpring(0.97, springSnappy);
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, springSoft);
        onPressOut?.(event);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressableView>
  );
}
