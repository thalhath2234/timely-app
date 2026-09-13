import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, Brain, Clock, Database, FolderKanban, Inbox, KeyRound, Moon, Sun, Tag } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { SectionLabel } from "../../../components/ui/primitives";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { colors, createThemedStyleSheet, getThemeMode, setThemePreference, type ThemeMode } from "../../../lib/theme";

function Row({
  icon: Icon,
  title,
  meta,
  onPress,
}: {
  icon: typeof Tag;
  title: string;
  meta: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      onPress={onPress}
      style={styles.card}
    >
      <View style={styles.icon}>
        <Icon size={18} color={colors.mutedForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
    </Pressable>
  );
}

export default function SettingsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getThemeMode);
  const [themeChanging, setThemeChanging] = useState(false);
  const initials = (user?.name ?? user?.email ?? "T")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const changeTheme = async (nextTheme: ThemeMode) => {
    if (nextTheme === themeMode || themeChanging) return;
    setThemeMode(nextTheme);
    setThemeChanging(true);
    try {
      await setThemePreference(nextTheme);
      setThemeChanging(false);
    } catch {
      setThemeMode(getThemeMode());
      setThemeChanging(false);
      Alert.alert("Theme not changed", "Timely could not save your appearance preference.");
    }
  };

  return (
    <Screen>
      <MobileHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom }}>
        <Pressable onPress={() => router.push("/(app)/settings/account")} style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.name}>{user?.name || "Your account"}</Text>
            <Text style={styles.meta}>{user?.email}</Text>
          </View>
        </Pressable>
        <SectionLabel>Appearance</SectionLabel>
        <View accessibilityLabel="Theme" style={styles.appearanceCard}>
          <Text style={styles.appearanceTitle}>Theme</Text>
          <Text style={styles.appearanceMeta}>Choose how Timely looks on this device.</Text>
          <View style={styles.themeOptions}>
            <ThemeOption
              icon={Sun}
              label="Light"
              selected={themeMode === "light"}
              disabled={themeChanging}
              onPress={() => void changeTheme("light")}
            />
            <ThemeOption
              icon={Moon}
              label="Dark"
              selected={themeMode === "dark"}
              disabled={themeChanging}
              onPress={() => void changeTheme("dark")}
            />
          </View>
        </View>
        <SectionLabel>Planning</SectionLabel>
        <Row icon={Sun} title="Today" meta="Focus, schedule, and end of day" onPress={() => router.push("/(app)/today")} />
        <Row icon={Inbox} title="Inbox" meta="Capture now, organize later" onPress={() => router.push("/(app)/inbox")} />
        <Row icon={Bell} title="Notifications" meta="Reminders, digests, and snooze" onPress={() => router.push("/(app)/notifications")} />
        <SectionLabel>Workspace</SectionLabel>
        <Row
          icon={FolderKanban}
          title="Projects"
          meta="List, stages, and project edit"
          onPress={() => router.push("/(app)/projects")}
        />
        <Row
          icon={Tag}
          title="Workspaces"
          meta="Statuses, labels, custom fields"
          onPress={() => router.push("/(app)/settings/workspaces")}
        />
        <SectionLabel>Tools</SectionLabel>
        <Row icon={Bell} title="Notification settings" meta="Push, quiet hours, and failed jobs" onPress={() => router.push("/(app)/settings/notifications")} />
        <Row icon={Brain} title="Report" meta="Weekly summary and focus time" onPress={() => router.push("/(app)/report")} />
        <Row icon={Clock} title="Working hours" meta="When the scheduler can place tasks" onPress={() => router.push("/(app)/settings/schedule")} />
        <Row icon={Database} title="Data & backups" meta="Export, restore, and encrypted backups" onPress={() => router.push("/(app)/settings/data")} />
        <Row icon={KeyRound} title="API keys" meta="Connect scripts and automations" onPress={() => router.push("/(app)/settings/api-keys")} />
        <Pressable onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function ThemeOption({
  icon: Icon,
  label,
  selected,
  disabled,
  onPress,
}: {
  icon: typeof Sun;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} theme`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.themeOption, selected && styles.themeOptionSelected]}
    >
      <Icon size={18} color={selected ? colors.primaryForeground : colors.mutedForeground} />
      <Text style={[styles.themeOptionText, selected && styles.themeOptionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.primaryForeground, fontWeight: "700" },
  name: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  appearanceCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    marginBottom: 8,
  },
  appearanceTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  appearanceMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 3 },
  themeOptions: { flexDirection: "row", gap: 8, marginTop: 14 },
  themeOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  themeOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  themeOptionText: { color: colors.mutedForeground, fontSize: 14, fontWeight: "600" },
  themeOptionTextSelected: { color: colors.primaryForeground },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  logout: { alignItems: "center", paddingVertical: 20 },
  logoutText: { color: colors.destructive, fontWeight: "600" },
}));
