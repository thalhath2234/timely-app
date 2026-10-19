import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Check } from "lucide-react-native";
import { motion as MOTION } from "@timely/contract/designTokens";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { easeOut, springSnappy } from "../../lib/motion";

/*
 * The phone half of the motion catalogue, in Reanimated, with the same
 * lengths as the web kit (apps/web/app/_components/_ui/dataMotion.tsx and
 * taskCheck.tsx): a number pops and counts up, a card tints for a second,
 * a bar fills from where it was, a task tick fills and strikes, loading
 * shows row shapes instead of "Loading…".
 */

const COUNT_MS = Math.round((20 / MOTION.fps) * 1000);
const FILL_MS = Math.round((6 / MOTION.fps) * 1000);
const STRIKE_MS = Math.round((10 / MOTION.fps) * 1000);
const COUNT_FROM = 10;

/** 0 on mount, then one higher every time `value` changes. */
export function useChangeKey(value: unknown) {
  const [key, setKey] = useState(0);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setKey((current) => current + 1);
  }, [value]);
  return key;
}

function numeric(value: ReactNode): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d{1,9}$/.test(value.trim())) return Number(value);
  return null;
}

/** A stat's number: pops (10 frames) when it changes and counts up when both values are numbers above 10. */
export function StatNumber({ value, style, numberOfLines }: { value: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const changeKey = useChangeKey(value);
  const reduce = useReducedMotion();
  const target = numeric(value);
  const [shown, setShown] = useState<number | null>(target);
  const lastTarget = useRef(target);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (changeKey > 0 && !reduce) {
      scale.value = 0.94;
      scale.value = withTiming(1, { duration: MOTION.ms.pop, easing: easeOut });
    }
  }, [changeKey, reduce, scale]);

  useEffect(() => {
    const from = lastTarget.current;
    lastTarget.current = target;
    if (target === null || from === null || from === target || reduce || Math.max(Math.abs(from), Math.abs(target)) <= COUNT_FROM) {
      setShown(target);
      return;
    }
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - started) / COUNT_MS);
      // The film's curve, close enough for a count: fast out, long settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.Text style={[style, animated]} numberOfLines={numberOfLines}>
      {target !== null && shown !== null ? shown.toLocaleString() : value}
    </Animated.Text>
  );
}

/** The tint a card shows for a second after its value changed; render inside a card with `overflow: hidden`. */
export function ChangeTint({ changeKey, color = colors.primary }: { changeKey: number; color?: string }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!changeKey || reduce) return;
    opacity.value = 0.14;
    opacity.value = withTiming(0, { duration: MOTION.ms.highlight, easing: easeOut });
  }, [changeKey, reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]} />;
}

/** A bar whose fill animates from its previous share to the new one over 20 frames. `value` is 0 to 1. */
export function Fill({
  value,
  color = colors.primary,
  height = 4,
  style,
}: {
  value: number;
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const share = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = reduce ? share : withTiming(share, { duration: COUNT_MS, easing: easeOut });
  }, [share, reduce, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View style={[{ height, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" }, style]}>
      <Animated.View style={[{ height: "100%", borderRadius: 999, backgroundColor: color }, fill]} />
    </View>
  );
}

/** A task's tick box: the fill grows in 6 frames and the tick settles on it. */
export function TaskCheck({
  checked,
  onToggle,
  label,
  shape = "circle",
  size = 22,
  tone = "success",
  borderColor,
  disabled = false,
  style,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  shape?: "circle" | "square";
  size?: number;
  tone?: "success" | "primary";
  /** The unchecked ring colour, when a row needs its own. */
  borderColor?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const fill = useSharedValue(checked ? 1 : 0);
  const press = useSharedValue(1);
  useEffect(() => {
    fill.value = reduce ? (checked ? 1 : 0) : withTiming(checked ? 1 : 0, { duration: FILL_MS, easing: easeOut });
  }, [checked, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scale: fill.value }], opacity: fill.value }));
  const tickStyle = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.6 + 0.4 * fill.value }] }));
  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const accent = tone === "primary" ? colors.primary : colors.success;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={10}
      onPressIn={() => {
        if (!reduce) press.value = withSpring(0.88, springSnappy);
      }}
      onPressOut={() => {
        press.value = withSpring(1, springSnappy);
      }}
      onPress={onToggle}
      style={style}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: shape === "circle" ? size / 2 : Math.round(size * 0.3),
            borderWidth: 1.5,
            borderColor: checked ? accent : borderColor ?? colors.mutedForeground,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
          boxStyle,
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: accent, borderRadius: 999 }, fillStyle]} />
        <Animated.View style={tickStyle}>
          <Check size={Math.round(size * 0.55)} color={colors.background} strokeWidth={3} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** A title whose strike-through grows across the first line when `done` turns on. */
export function StrikeTitle({
  done,
  style,
  children,
  numberOfLines = 2,
}: {
  done: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const reduce = useReducedMotion();
  const [measure, setMeasure] = useState<{ width: number; lineHeight: number } | null>(null);
  const grow = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    grow.value = reduce
      ? done
        ? 1
        : 0
      : done
        ? withDelay(FILL_MS, withTiming(1, { duration: STRIKE_MS, easing: easeOut }))
        : withTiming(0, { duration: STRIKE_MS / 2, easing: easeOut });
  }, [done, reduce, grow]);
  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const lineHeight = flat?.lineHeight ?? (flat?.fontSize ? flat.fontSize * 1.35 : 19);
  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
      <Text
        numberOfLines={numberOfLines}
        style={[style, done && { color: colors.mutedForeground }]}
        onTextLayout={(event) => {
          const first = event.nativeEvent.lines[0];
          if (first && (first.width !== measure?.width || first.height !== measure?.lineHeight)) {
            setMeasure({ width: first.width, lineHeight: first.height || lineHeight });
          }
        }}
      >
        {children}
      </Text>
      {measure ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              top: measure.lineHeight / 2,
              width: measure.width,
              height: 1,
              backgroundColor: colors.mutedForeground,
              transformOrigin: "left",
            },
            line,
          ]}
        />
      ) : null}
    </View>
  );
}

/** Row shapes while a list loads; `rows` of `height` px in one card. */
export function SkeletonRows({ rows = 5, height = 48, style, bare = false }: { rows?: number; height?: number; style?: StyleProp<ViewStyle>; bare?: boolean }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    pulse.value = withRepeat(withSequence(withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })), -1, false);
  }, [reduce, pulse]);
  const pulsing = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const widths = ["58%", "42%", "66%", "36%", "50%", "61%"] as const;
  return (
    <Animated.View accessibilityLabel="Loading" style={[!bare && styles.group, style, pulsing]} entering={FadeIn.duration(150)}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, { height }, index > 0 && !bare && styles.divider]}>
          <View style={styles.dot} />
          <View style={[styles.bone, { width: widths[index % widths.length] }]} />
          <View style={[styles.bone, styles.boneRight]} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  group: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.muted },
  bone: { height: 12, borderRadius: 6, backgroundColor: colors.muted },
  boneRight: { width: 44, marginLeft: "auto" },
}));
