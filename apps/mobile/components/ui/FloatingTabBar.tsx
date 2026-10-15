import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Tabs } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, createThemedStyleSheet, hexToRgb, radius } from "../../lib/theme";
import { springSoft } from "../../lib/motion";
import AnimatedPressable from "./AnimatedPressable";

export const FLOATING_TAB_HEIGHT = 58;
export const FLOATING_TAB_MARGIN = 12;
const PILL_INSET_X = 4;
const PILL_INSET_Y = 5;
// A large system font must not push "Dashboard" past its tab.
const LABEL_MAX_SCALE = 1.15;
const VISIBLE_TABS = new Set(["home", "dashboard", "calendar", "tasks", "search", "files"]);

export function floatingTabBarInset(bottomInset: number) {
  return Math.max(bottomInset, 8) + FLOATING_TAB_MARGIN + FLOATING_TAB_HEIGHT;
}

// Air each side of a label when there is room; the pill's inset at least.
const LABEL_SIDE = PILL_INSET_X + 4;
// Reported layout widths are rounded; without slack a label can lose a
// fraction of a pixel and get an ellipsis.
const LABEL_SLACK = 2;

/**
 * Six tabs don't fit as equal columns on a 360dp phone ("Dashboard" is wider
 * than a sixth of the bar). Tabs whose label needs more than an equal share
 * get exactly what they need; the rest split what is left evenly, so short
 * labels keep the widest tap targets. When the bar is too narrow for full
 * side air, the air shrinks before any label does.
 */
export function fitTabWidths(total: number, labelWidths: number[]): number[] {
  const n = labelWidths.length;
  const text = labelWidths.map((width) => Math.ceil(width) + LABEL_SLACK);
  const textSum = text.reduce((a, b) => a + b, 0);
  if (textSum >= total) return text.map((width) => (width / textSum) * total);
  const side = Math.min(LABEL_SIDE, (total - textSum) / (2 * n));
  const needs = text.map((width) => width + side * 2);
  const widths = needs.map(() => 0);
  let open = needs.map((_, i) => i);
  let room = total;
  for (;;) {
    const share = room / open.length;
    const wide = open.filter((i) => needs[i] > share);
    if (!wide.length) {
      for (const i of open) widths[i] = share;
      return widths;
    }
    for (const i of wide) {
      widths[i] = needs[i];
      room -= needs[i];
    }
    open = open.filter((i) => needs[i] <= share);
  }
}

function primaryWash(alpha: number) {
  const rgb = hexToRgb(colors.primary);
  if (!rgb) return `rgba(129,140,248,${alpha})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export default function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const ready = useSharedValue(0);
  const [barWidth, setBarWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});

  const tabs = useMemo(
    () => state.routes.filter((route) => VISIBLE_TABS.has(route.name)),
    [state.routes],
  );
  const activeKey = state.routes[state.index]?.key;
  const labels = tabs.map((route) => {
    const { options } = descriptors[route.key];
    const raw = options.tabBarLabel;
    return typeof raw === "string" ? raw : options.title ?? route.name;
  });
  const measured = barWidth > 0 && tabs.every((route) => labelWidths[route.key] !== undefined);
  const widths = measured
    ? fitTabWidths(barWidth, tabs.map((route) => labelWidths[route.key]))
    : null;
  const wash = primaryWash(0.18);

  function movePill(x: number, width: number, animate: boolean) {
    const nextX = x + PILL_INSET_X;
    const nextW = Math.max(0, width - PILL_INSET_X * 2);
    if (animate && ready.value && !reduceMotion) {
      pillX.value = withSpring(nextX, springSoft);
      pillW.value = withSpring(nextW, springSoft);
      return;
    }
    pillX.value = nextX;
    pillW.value = nextW;
    ready.value = 1;
  }

  useEffect(() => {
    if (!activeKey) return;
    const layout = layouts.current[activeKey];
    if (!layout) return;
    movePill(layout.x, layout.width, true);
  }, [activeKey]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillW.value,
    opacity: pillW.value > 0 ? 1 : 0,
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      <View style={styles.bar}>
        {/* Off-screen copy of the labels at their natural width, for fitTabWidths. */}
        <View pointerEvents="none" aria-hidden style={styles.measure}>
          {tabs.map((route, i) => (
            <Text
              key={route.key}
              numberOfLines={1}
              maxFontSizeMultiplier={LABEL_MAX_SCALE}
              style={styles.label}
              onLayout={(event: LayoutChangeEvent) => {
                const width = event.nativeEvent.layout.width;
                setLabelWidths((prev) => (prev[route.key] === width ? prev : { ...prev, [route.key]: width }));
              }}
            >
              {labels[i]}
            </Text>
          ))}
        </View>
        <View
          style={styles.row}
          onLayout={(event: LayoutChangeEvent) => setBarWidth(event.nativeEvent.layout.width)}
        >
          <Animated.View pointerEvents="none" style={[styles.pill, { backgroundColor: wash }, pillStyle]} />
          {tabs.map((route, i) => {
            const focused = route.key === activeKey;
            const { options } = descriptors[route.key];
            const color = focused ? colors.primary : colors.mutedForeground;
            const label = labels[i];
            return (
              <View
                key={route.key}
                collapsable={false}
                style={widths ? { width: widths[i] } : styles.tab}
                onLayout={(event: LayoutChangeEvent) => {
                  const { x, width } = event.nativeEvent.layout;
                  layouts.current[route.key] = { x, width };
                  if (route.key === activeKey) movePill(x, width, ready.value === 1);
                }}
              >
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? String(label)}
                  android_ripple={{ color: "transparent", borderless: false, foreground: false }}
                  onPress={() => {
                    const nextLayout = layouts.current[route.key];
                    if (nextLayout) movePill(nextLayout.x, nextLayout.width, true);
                    const event = navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!focused && !event.defaultPrevented) {
                      navigation.navigate(route.name, route.params);
                    } else if (event.defaultPrevented) {
                      const currentLayout = activeKey ? layouts.current[activeKey] : undefined;
                      if (currentLayout) movePill(currentLayout.x, currentLayout.width, true);
                    }
                  }}
                  style={styles.tabHit}
                >
                  {options.tabBarIcon?.({ focused, color, size: 20 })}
                  <Text numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE} style={[styles.label, { color }]}>
                    {label}
                  </Text>
                </AnimatedPressable>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingHorizontal: FLOATING_TAB_MARGIN,
    paddingTop: 8,
    backgroundColor: "transparent",
    elevation: 0,
  },
  bar: {
    height: FLOATING_TAB_HEIGHT,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: radius,
  },
  pill: {
    position: "absolute",
    top: PILL_INSET_Y,
    bottom: PILL_INSET_Y,
    borderRadius: radius,
  },
  // Until the labels are measured (first frame).
  tab: {
    flex: 1,
  },
  measure: {
    position: "absolute",
    left: 0,
    top: 0,
    flexDirection: "row",
    opacity: 0,
  },
  // The whole column takes the tap, not just the pill inside it.
  tabHit: {
    flex: 1,
    marginVertical: PILL_INSET_Y,
    borderRadius: radius,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: { fontSize: 11, fontWeight: "600" },
}));
