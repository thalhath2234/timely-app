import { useEffect, useState } from "react";
import { Tabs, usePathname } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calendar, FileText, Home, ListTodo, Plus, Search } from "lucide-react-native";
import QuickAddSheet from "../../../components/ui/QuickAddSheet";
import AutoScheduleBanner from "../../../components/ui/AutoScheduleBanner";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import FloatingTabBar, { floatingTabBarInset } from "../../../components/ui/FloatingTabBar";
import { subscribeQuickAdd, type QuickAddPreset } from "../../../lib/quickAddIntent";
import { colors, createThemedStyleSheet, radius } from "../../../lib/theme";
import { tabAnimation } from "../../../lib/motion";

export default function TabLayout() {
  const [addOpen, setAddOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<QuickAddPreset | null>(null);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const hideFab = pathname.endsWith("/more") || pathname.endsWith("/search");
  const tabOffset = floatingTabBarInset(insets.bottom);

  useEffect(() => {
    return subscribeQuickAdd((preset) => {
      setAddPreset(preset);
      setAddOpen(true);
    });
  }, []);

  return (
    <>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          animation: tabAnimation(Boolean(reduceMotion)),
          freezeOnBlur: true,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: "transparent",
            borderTopWidth: 0,
            elevation: 0,
            height: 0,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
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
          wrapStyle={[styles.fab, { bottom: tabOffset + 12 }]}
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
    width: 56,
    height: 56,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  fabHit: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
}));
