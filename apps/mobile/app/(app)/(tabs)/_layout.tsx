import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { Tabs, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calendar, FileText, ListTodo, Plus, Search, Settings } from "lucide-react-native";
import QuickAddSheet from "../../../components/ui/QuickAddSheet";
import AutoScheduleBanner from "../../../components/ui/AutoScheduleBanner";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { tabAnimation } from "../../../lib/motion";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function TabLayout() {
  const [addOpen, setAddOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const hideFab = pathname.endsWith("/more") || pathname.endsWith("/search");
  const bottomInset = Math.max(insets.bottom, 8);
  const tabHeight = 56 + bottomInset;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          animation: tabAnimation(reduceMotion),
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            height: tabHeight,
            paddingBottom: bottomInset,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.foreground,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="calendar"
          options={{ title: "Calendar", tabBarIcon: ({ color }) => <Calendar size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="tasks"
          options={{ title: "Tasks", tabBarIcon: ({ color }) => <ListTodo size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="search"
          options={{ title: "Search", tabBarIcon: ({ color }) => <Search size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="docs"
          options={{ title: "Files", tabBarIcon: ({ color }) => <FileText size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="more"
          options={{ title: "Settings", tabBarIcon: ({ color }) => <Settings size={20} color={color} /> }}
        />
        <Tabs.Screen name="sheets" options={{ href: null }} />
      </Tabs>
      {!hideFab ? (
        <AnimatedPressable
          accessibilityLabel="Add"
          onPress={() => setAddOpen(true)}
          wrapStyle={[styles.fab, { bottom: tabHeight + 12 }]}
          style={styles.fabHit}
        >
          <Plus size={26} color={colors.primaryForeground} />
        </AnimatedPressable>
      ) : null}
      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <AutoScheduleBanner />
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  fab: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabHit: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
}));
