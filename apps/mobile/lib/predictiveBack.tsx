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
 * 3 "back preview"), and the screen you're going back to shows, live, behind
 * it. Pushed screens are transparent stack screens on Android (see
 * `predictiveBackScreenOptions`), so the one underneath stays drawn.
 * At the root (Home with nothing to go back to) the app steps aside and
 * Android plays its own back-to-home animation.
 */

const SCALE_AT_END = 0.9;
const SHIFT_AT_END = 24;
const RADIUS_AT_END = 28;
/** How long the stack's pop takes to cover the screen; after that it settles if it's still here. */
const POP_GRACE_MS = 400;

/**
 * Stack options that keep the screen underneath drawn, so the back preview
 * shows it. Only with the native back module (a dev or release build); Expo
 * Go and iOS keep plain cards.
 */
export function predictiveBackScreenOptions(isRoot: boolean) {
  if (isRoot || !hasTimelyAndroid()) return null;
  return { presentation: "transparentModal" as const, contentStyle: { backgroundColor: "transparent" } };
}

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
    let settle: ReturnType<typeof setTimeout> | undefined;
    const remove = addBackListener((event) => {
      clearTimeout(settle);
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
          // The stack's pop slides the screen out from where the swipe left
          // it. If Back went to something else and the screen is still on
          // top, it settles back to full size.
          settle = setTimeout(() => {
            if (navigation.isFocused()) progress.value = withTiming(0, { duration: 260 });
          }, POP_GRACE_MS);
          break;
      }
    });
    return () => {
      clearTimeout(settle);
      remove();
    };
  }, [navigation, progress, direction, reduceMotion]);

  const style = useAnimatedStyle(() => {
    const p = Easing.out(Easing.quad)(progress.value);
    return {
      borderRadius: RADIUS_AT_END * p,
      transform: [{ translateX: direction.value * SHIFT_AT_END * p }, { scale: 1 - (1 - SCALE_AT_END) * p }],
    };
  });
  // Dark page over a dark screen: a hairline keeps the page's edge visible.
  const edgeStyle = useAnimatedStyle(() => {
    const p = Easing.out(Easing.quad)(progress.value);
    return { borderRadius: RADIUS_AT_END * p, opacity: Math.min(1, p * 4) };
  });

  // The well is clear so the previous screen shows through. The shadow and
  // the hairline only show once the page shrinks.
  return (
    <View style={styles.well}>
      <Animated.View style={[styles.screen, { backgroundColor: colors.background }, style]}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.edge, { borderColor: colors.border }, edgeStyle]} />
      </Animated.View>
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
  screen: { flex: 1, overflow: "hidden", elevation: 16 },
  edge: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: StyleSheet.hairlineWidth },
});
