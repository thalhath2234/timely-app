import { useEffect, type ReactNode } from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { addBackListener, hasTimelyAndroid, setAppHandlesBack } from "../modules/timely-android";
import { backPlan, type NavState } from "./backPlan";
import { colors } from "./theme";

/**
 * Android's back swipe. The top screen stays put until the finger is past the
 * back threshold (16dp from where it touched down, see TimelyBack), then slides
 * fully away from the edge the swipe started at, and the screen you're going
 * back to shows, live, behind it. Letting go there goes back. Only bringing the
 * finger back inside the threshold slides the screen back in, and letting go
 * then cancels. Pushed screens are transparent stack screens on Android (see
 * `predictiveBackScreenOptions`), so the one underneath stays drawn.
 * At the root (Home with nothing to go back to) the app steps aside and
 * Android plays its own back-to-home animation.
 */

/** Corner radius of the page once it starts moving (the kit's large radius). */
const RADIUS = 20;
/** How dark the screen behind is at the start of the swipe; it clears as the page leaves. */
const SCRIM = 0.28;
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
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (!hasTimelyAndroid() || reduceMotion) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let armed = 0;
    const remove = addBackListener((event) => {
      clearTimeout(settle);
      // Only the screen on top of a stack that can pop previews; tab roots
      // and the first screen leave the gesture to the navigator or Android.
      if (!navigation.isFocused() || navigation.getState().index === 0) {
        armed = 0;
        progress.value = 0;
        return;
      }
      switch (event.type) {
        case "started":
        case "progress": {
          const target = event.armed ? 1 : 0;
          if (target === armed) break;
          armed = target;
          // From the right edge the page leaves to the left, and the other way round.
          if (target) direction.value = event.edge === "right" ? -1 : 1;
          progress.value = withTiming(target, { duration: target ? 220 : 200, easing: Easing.out(Easing.cubic) });
          break;
        }
        case "cancelled":
          armed = 0;
          progress.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
          break;
        case "invoked":
          // The page is already gone, so the stack's pop just reveals the
          // screen behind. If Back went to something else and the screen is
          // still on top, it slides back in.
          armed = 0;
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
    const p = progress.value;
    return {
      borderRadius: RADIUS * Math.min(1, p * 8),
      transform: [{ translateX: direction.value * width * p }],
    };
  });
  // Dark page over a dark screen: a hairline keeps the page's edge visible.
  const edgeStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return { borderRadius: RADIUS * Math.min(1, p * 8), opacity: Math.min(1, p * 8) };
  });
  // The screen behind starts a little dim and brightens as the page leaves.
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value > 0 ? SCRIM * (1 - progress.value) : 0 }));

  // The well is clear so the previous screen shows through, under a scrim
  // that clears as the page goes. The shadow and hairline show once it moves.
  return (
    <View style={styles.well}>
      <Animated.View pointerEvents="none" style={[styles.fill, styles.scrim, scrimStyle]} />
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
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { backgroundColor: "#000" },
  edge: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: StyleSheet.hairlineWidth },
});
