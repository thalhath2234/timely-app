import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Tabs, usePathname } from "expo-router";
import { Calendar, FileText, ListTodo, Menu, Plus, Sheet } from "lucide-react-native";
import QuickAddSheet from "../../../components/ui/QuickAddSheet";
import { colors } from "../../../lib/theme";

export default function TabLayout() {
  const [addOpen, setAddOpen] = useState(false);
  const pathname = usePathname();
  const showFab = !pathname.endsWith("/more");

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.bar,
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
          name="docs"
          options={{ title: "Docs", tabBarIcon: ({ color }) => <FileText size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="sheets"
          options={{ title: "Sheets", tabBarIcon: ({ color }) => <Sheet size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="more"
          options={{ title: "More", tabBarIcon: ({ color }) => <Menu size={20} color={color} /> }}
        />
      </Tabs>
      {showFab ? (
        <Pressable accessibilityLabel="Add" onPress={() => setAddOpen(true)} style={styles.fab}>
          <Plus size={26} color={colors.primaryForeground} />
        </Pressable>
      ) : null}
      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    height: 64,
    paddingBottom: 8,
    paddingTop: 8,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 80,
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
});
