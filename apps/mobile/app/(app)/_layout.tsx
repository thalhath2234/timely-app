import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { Redirect, Stack } from "expo-router";
import ReminderNotifications from "../../components/ReminderNotifications";
import AndroidBridges from "../../components/AndroidBridges";
import AccountAppearanceSync from "../../components/AccountAppearanceSync";
import StartupLoader from "../../components/ui/StartupLoader";
import ToastHost from "../../components/ui/ToastHost";
import { isOnboarded, useAuth } from "../../lib/auth/AuthProvider";
import { stackFadeAnimation, stackPushAnimation } from "../../lib/motion";
import { colors } from "../../lib/theme";
import { PredictiveBackScreen, predictiveBackScreenOptions } from "../../lib/predictiveBack";
import { hasTimelyAndroid } from "../../modules/timely-android";

export default function AppLayout() {
  const { ready, token, user } = useAuth();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  if (!ready) return <StartupLoader />;
  if (!token) return <Redirect href="/login" />;
  if (!user) return <Redirect href="/login" />;
  if (!isOnboarded(user)) return <Redirect href="/onboarding" />;

  return (
    <>
      <ReminderNotifications />
      <AccountAppearanceSync />
      <AndroidBridges />
      <Stack
        screenLayout={
          hasTimelyAndroid()
            ? ({ children, navigation }) => <PredictiveBackScreen navigation={navigation}>{children}</PredictiveBackScreen>
            : undefined
        }
        screenOptions={({ route }: { route: { name: string } }) => {
          const fade =
            route.name === "(tabs)" ||
            route.name === "search" ||
            route.name === "today" ||
            route.name === "inbox" ||
            route.name === "notifications" ||
            route.name === "shortcut/[action]";
          return {
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: fade ? stackFadeAnimation(reduceMotion) : stackPushAnimation(reduceMotion),
            animationDuration: fade ? 220 : 320,
            gestureEnabled: !reduceMotion && !fade,
            fullScreenGestureEnabled: !reduceMotion && !fade,
            // Android: the screen underneath stays drawn for the back preview.
            ...predictiveBackScreenOptions(route.name === "(tabs)"),
          };
        }}
      />
      {/* After the stack so toasts (and their Undo) draw above every screen. */}
      <ToastHost />
    </>
  );
}
