import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { Tabs, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calendar, FileText, Home, ListTodo, Plus, Search } from "lucide-react-native";
import QuickAddSheet from "../../../components/ui/QuickAddSheet";
import AutoScheduleBanner from "../../../components/ui/AutoScheduleBanner";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { tabAnimation } from "../../../lib/motion";
import { subscribeQuickAdd, type QuickAddPreset } from "../../../lib/quickAddIntent";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function TabLayout() {
  const [addOpen, setAddOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<QuickAddPreset | null>(null);
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

  useEffect(() => {
    return subscribeQuickAdd((preset) => {
      setAddPreset(preset);
      setAddOpen(true);
    });
  }, []);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          animation: tabAnimation(reduceMotion),
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: "transparent",
            borderTopWidth: 0,
            height: tabHeight,
            paddingBottom: bottomInset,
            paddingTop: 8,
            marginHorizontal: 12,
            marginBottom: 8,
            borderRadius: 22,
            elevation: 12,
            shadowColor: "#000",
            shadowOpacity: 0.28,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{ title: "Home", tabBarIcon: ({ color }) => <Home size={20} color={color} /> }}
        />
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
        <Tabs.Screen name="more" options={{ href: null, title: "Settings" }} />
        <Tabs.Screen name="sheets" options={{ href: null }} />
      </Tabs>
      {!hideFab ? (
        <AnimatedPressable
          accessibilityLabel="Add"
          onPress={() => {
            setAddPreset(null);
            setAddOpen(true);
          }}
          wrapStyle={[styles.fab, { bottom: tabHeight + 12 }]}
          style={styles.fabHit}
        >
          <Plus size={26} color={colors.primaryForeground} />
        </AnimatedPressable>
      ) : null}
      <QuickAddSheet
        open={addOpen}
        preset={addPreset}
        onClose={() => {
          setAddOpen(false);
          setAddPreset(null);
        }}
      />
      <AutoScheduleBanner />
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  fab: {
    position: "absolute",
    right: 18,
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  fabHit: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
}));
