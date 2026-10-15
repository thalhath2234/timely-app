import { useEffect, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { addBackListener, hasTimelyAndroid, setAppHandlesBack } from "../modules/timely-android";
import { backPlan, type NavState } from "./backPlan";
import { colors } from "./theme";

/**
 * Android's predictive back gesture. While the swipe runs, the top screen
 * shrinks toward the edge it came from and rounds its corners (the Material
 * 3 "back preview"), so you see Back is about to happen before you let go.
 * At the root (Home with nothing to go back to) the app steps aside and
 * Android plays its own back-to-home animation.
 */

const SCALE_AT_END = 0.9;
const SHIFT_AT_END = 24;
const RADIUS_AT_END = 28;

type StackNavigation = {
  isFocused: () => boolean;
  getState: () => { index: number };
};

/** Wraps each screen of a Stack (`screenLayout`) so it follows the back swipe. */
export function PredictiveBackScreen({ navigation, children }: { navigation: StackNavigation; children: ReactNode }) {
  const progress = useSharedValue(0);
  const direction = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!hasTimelyAndroid() || reduceMotion) return;
    return addBackListener((event) => {
      // Only the screen on top of a stack that can pop previews; tab roots
      // and the first screen leave the gesture to the navigator or Android.
      if (!navigation.isFocused() || navigation.getState().index === 0) {
        progress.value = 0;
        return;
      }
      switch (event.type) {
        case "started":
        case "progress":
          direction.value = event.edge === "right" ? -1 : 1;
          progress.value = Math.min(1, Math.max(0, event.progress));
          break;
        case "cancelled":
          progress.value = withSpring(0, { damping: 18, stiffness: 220 });
          break;
        case "invoked":
          // The stack's pop animation takes it from here; if Back was used for
          // something else (closing a menu), the screen settles back.
          progress.value = withTiming(0, { duration: 260 });
          break;
      }
    });
  }, [navigation, progress, direction, reduceMotion]);

  const style = useAnimatedStyle(() => {
    const p = Easing.out(Easing.quad)(progress.value);
    return {
      borderRadius: RADIUS_AT_END * p,
      transform: [{ translateX: direction.value * SHIFT_AT_END * p }, { scale: 1 - (1 - SCALE_AT_END) * p }],
    };
  });

  // The well behind the shrinking screen is the app's fill colour, so its
  // rounded edges read against it.
  return (
    <View style={[styles.well, { backgroundColor: colors.muted }]}>
      <Animated.View style={[styles.screen, { backgroundColor: colors.background }, style]}>{children}</Animated.View>
    </View>
  );
}

/**
 * Keeps Android's Back in step with the app on every navigation: Android only
 * takes Back (and leaves the app) at a true root, and a screen with nothing to
 * pop goes up to where it belongs instead of closing the app.
 */
export function useBackSync() {
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  useEffect(() => {
    if (!hasTimelyAndroid()) return;
    const plan = () =>
      navigation.isReady()
        ? backPlan(navigation.getRootState() as NavState | undefined, navigation.canGoBack())
        : backPlan(undefined, false);
    // The container's state event fires for every nested change (a push, a
    // tab switch, a pop), unlike reading the root state during render.
    const sync = () => setAppHandlesBack(plan().kind !== "leave");
    sync();
    const offState = navigation.addListener("state", sync);
    const offReady = navigation.addListener("ready", sync);
    // Registered at the root, so a screen's own Back handler runs first.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const next = plan();
      if (next.kind !== "up") return false;
      router.replace(next.href as never);
      return true;
    });
    return () => {
      offState();
      offReady();
      sub.remove();
    };
  }, [navigation, router]);
}

const styles = StyleSheet.create({
  well: { flex: 1 },
  screen: { flex: 1, overflow: "hidden" },
});
