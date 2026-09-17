import { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import ReminderNotifications from "../../components/ReminderNotifications";
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

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;
  if (!isOnboarded(user)) return <Redirect href="/onboarding" />;

  return (
    <>
      <ReminderNotifications />
      <ToastHost />
      <Stack
        screenOptions={({ route }: { route: { name: string } }) => {
          const fade =
            route.name === "(tabs)" ||
            route.name === "search" ||
            route.name === "today" ||
            route.name === "inbox" ||
            route.name === "report" ||
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
