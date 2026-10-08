import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { Redirect, Stack } from "expo-router";
import ReminderNotifications from "../../components/ReminderNotifications";
import AccountAppearanceSync from "../../components/AccountAppearanceSync";
import StartupLoader from "../../components/ui/StartupLoader";
import ToastHost from "../../components/ui/ToastHost";
import { isOnboarded, useAuth } from "../../lib/auth/AuthProvider";
import { stackFadeAnimation, stackPushAnimation } from "../../lib/motion";
import { colors } from "../../lib/theme";

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
      <ToastHost />
      <Stack
        screenOptions={({ route }: { route: { name: string } }) => {
          const fade =
            route.name === "(tabs)" ||
            route.name === "search" ||
            route.name === "today" ||
            route.name === "inbox" ||
            route.name === "dashboard" ||
            route.name === "notifications";
          return {
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: fade ? stackFadeAnimation(reduceMotion) : stackPushAnimation(reduceMotion),
            animationDuration: fade ? 220 : 320,
            gestureEnabled: !reduceMotion && !fade,
            fullScreenGestureEnabled: !reduceMotion && !fade,
          };
        }}
      />
    </>
  );
}
