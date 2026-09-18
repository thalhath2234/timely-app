import { useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth/AuthProvider";
import { colors, createThemedStyleSheet, initializeTheme, ThemeRoot } from "../lib/theme";
import { stackFadeAnimation, stackPushAnimation } from "../lib/motion";
import ConnectivityBanner from "../components/ConnectivityBanner";
import { SheetHost } from "../components/ui/SheetHost";
import { requestNotificationPermission } from "../lib/notifications";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      initializeTheme(),
      AccessibilityInfo.isReduceMotionEnabled(),
    ]).then(([, motionReduced]) => {
      if (!mounted) return;
      setReduceMotion(motionReduced);
      setReady(true);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready || (!fontsLoaded && !fontError)) return;
    SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, fontsLoaded, fontError]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      requestNotificationPermission().catch(() => false);
    }, 400);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready || (!fontsLoaded && !fontError)) return null;

  return (
    <ThemeRoot>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <View style={styles.shell}>
            <StatusBar style={colorScheme === "light" ? "dark" : "light"} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: stackFadeAnimation(reduceMotion),
                animationDuration: 280,
                gestureEnabled: !reduceMotion,
              }}
            >
              <Stack.Screen name="index" options={{ animation: "none" }} />
              <Stack.Screen name="login" options={{ animation: stackFadeAnimation(reduceMotion) }} />
              <Stack.Screen name="signup" options={{ animation: stackPushAnimation(reduceMotion) }} />
              <Stack.Screen name="onboarding" options={{ animation: stackFadeAnimation(reduceMotion) }} />
              <Stack.Screen name="(app)" options={{ animation: stackFadeAnimation(reduceMotion) }} />
            </Stack>
            <ConnectivityBanner />
            <SheetHost />
          </View>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </ThemeRoot>
  );
}

const styles = createThemedStyleSheet(() => ({
  shell: { flex: 1 },
}));
