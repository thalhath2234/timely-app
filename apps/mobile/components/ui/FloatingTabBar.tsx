import { useEffect, useMemo, useRef, type ComponentProps } from "react";
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
const VISIBLE_TABS = new Set(["home", "calendar", "tasks", "search", "docs"]);

export function floatingTabBarInset(bottomInset: number) {
  return Math.max(bottomInset, 8) + FLOATING_TAB_MARGIN + FLOATING_TAB_HEIGHT;
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

  const tabs = useMemo(
    () => state.routes.filter((route) => VISIBLE_TABS.has(route.name)),
    [state.routes],
  );
  const activeKey = state.routes[state.index]?.key;
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
        <View style={styles.row}>
          <Animated.View pointerEvents="none" style={[styles.pill, { backgroundColor: wash }, pillStyle]} />
          {tabs.map((route) => {
            const focused = route.key === activeKey;
            const { options } = descriptors[route.key];
            const color = focused ? colors.primary : colors.mutedForeground;
            const rawLabel = options.tabBarLabel;
            const label = typeof rawLabel === "string" ? rawLabel : options.title ?? route.name;
            return (
              <View
                key={route.key}
                collapsable={false}
                style={styles.tab}
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
                    const event = navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!focused && !event.defaultPrevented) {
                      navigation.navigate(route.name, route.params);
                    }
                  }}
                  style={styles.tabHit}
                >
                  {options.tabBarIcon?.({ focused, color, size: 20 })}
                  <Text style={[styles.label, { color }]}>{label}</Text>
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
  tab: {
    flex: 1,
  },
  tabHit: {
    flex: 1,
    marginHorizontal: PILL_INSET_X,
    marginVertical: PILL_INSET_Y,
    borderRadius: radius,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: { fontSize: 11, fontWeight: "600" },
}));
