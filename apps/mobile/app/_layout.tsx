import { useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth/AuthProvider";
import { colors, initializeTheme } from "../lib/theme";
import ConnectivityBanner from "../components/ConnectivityBanner";
import { requestNotificationPermission } from "../lib/notifications";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const colorScheme = useColorScheme();

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      initializeTheme(),
      AccessibilityInfo.isReduceMotionEnabled(),
    ]).then(([, motionReduced]) => {
      if (!mounted) return;
      setReduceMotion(motionReduced);
      setReady(true);
      SplashScreen.hideAsync().catch(() => undefined);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      requestNotificationPermission().catch(() => false);
    }, 400);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style={colorScheme === "light" ? "dark" : "light"} />
          <ConnectivityBanner />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: reduceMotion ? "none" : "fade",
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
