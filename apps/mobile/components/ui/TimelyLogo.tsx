import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import { colors } from "../../lib/theme";

/**
 * The Timely mark ("1a Agenda"): three Blocks on a 32-unit grid, the middle
 * one an Engine block. Ink follows the theme foreground and the accent block
 * follows the account's primary colour. Mirrors
 * `apps/web/app/_components/_ui/timelyLogo.tsx`, including its props and
 * seconds-based `duration`.
 */
const GRID = 32;
const BAR_HEIGHT = 5.5;
const BAR_X = 4;
const BARS = [
  { y: 5.5, width: 24, accent: false, delay: 0 },
  { y: 21, width: 20, accent: false, delay: 0.04 },
  { y: 13.25, width: 15, accent: true, delay: 0.1 },
] as const;

/** Each block draws in from the left, holds, then clears for the next loop. */
const drawIn: CSSAnimationKeyframes = {
  "0%": { transform: [{ scaleX: 0 }] },
  "18%": { transform: [{ scaleX: 1 }] },
  "82%": { transform: [{ scaleX: 1 }] },
  "96%": { transform: [{ scaleX: 0 }] },
  "100%": { transform: [{ scaleX: 0 }] },
};

/**
 * "brand" colours the middle block with the theme primary. "mono" draws it in
 * the ink colour at reduced opacity, for primary buttons and tinted pills
 * where the primary would vanish.
 */
export type LogoTone = "brand" | "mono";

/** Seconds per loop for the startup loader and for inline spinners. */
export const LOGO_LOOP_SECONDS = 4;
export const SPINNER_LOOP_SECONDS = 2.6;

type TimelyLogoProps = {
  size?: number;
  /** Loop the "blocks being placed" animation. Static when reduce-motion is on. */
  animated?: boolean;
  /** Seconds per loop when animated. */
  duration?: number;
  ink?: string;
  accent?: string;
  tone?: LogoTone;
  style?: StyleProp<ViewStyle>;
};

export default function TimelyLogo({
  size = 28,
  animated = false,
  duration = LOGO_LOOP_SECONDS,
  ink,
  accent,
  tone = "brand",
  style,
}: TimelyLogoProps) {
  const reduceMotion = useReducedMotion();
  const animate = animated && !reduceMotion;
  const unit = size / GRID;
  const inkColor = ink ?? colors.foreground;
  const accentColor = tone === "mono" ? inkColor : (accent ?? colors.primary);
  const accentOpacity = tone === "mono" ? 0.55 : 1;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessibilityRole="image"
      accessibilityLabel="Timely"
    >
      {BARS.map((bar) => {
        const base: ViewStyle = {
          position: "absolute",
          left: BAR_X * unit,
          top: bar.y * unit,
          width: bar.width * unit,
          height: BAR_HEIGHT * unit,
          borderRadius: (BAR_HEIGHT * unit) / 2,
          backgroundColor: bar.accent ? accentColor : inkColor,
          opacity: bar.accent ? accentOpacity : 1,
        };
        if (!animate) return <View key={bar.y} style={base} />;
        return (
          <Animated.View
            key={bar.y}
            style={[
              base,
              {
                transformOrigin: "left center",
                animationName: drawIn,
                animationDuration: duration * 1000,
                animationDelay: bar.delay * duration * 1000,
                animationTimingFunction: cubicBezier(0.65, 0, 0.35, 1),
                animationIterationCount: "infinite",
                animationFillMode: "both",
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * Inline busy indicator: the animated mark at icon size, looping faster than
 * the startup loader. Drop-in for a small `ActivityIndicator`; `color` draws
 * the whole mark in one colour (mono) for buttons and tinted status chips.
 */
export function LogoSpinner({
  size = 18,
  color,
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TimelyLogo
      size={size}
      animated
      duration={SPINNER_LOOP_SECONDS}
      ink={color}
      tone={color ? "mono" : "brand"}
      style={style}
    />
  );
}
