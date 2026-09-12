import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, Brain, Clock, FolderKanban, KeyRound, Tag } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { SectionLabel } from "../../../components/ui/primitives";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { colors } from "../../../lib/theme";

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
    <Pressable onPress={onPress} style={styles.card}>
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
  const initials = (user?.name ?? user?.email ?? "T")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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
        <Row icon={Bell} title="Notifications" meta="Pings when a reminder is due" onPress={() => router.push("/(app)/settings/notifications")} />
        <Row icon={Brain} title="Report" meta="Weekly summary and focus time" onPress={() => router.push("/(app)/report")} />
        <Row icon={Clock} title="Working hours" meta="When the scheduler can place tasks" onPress={() => router.push("/(app)/settings/schedule")} />
        <Row icon={KeyRound} title="API keys" meta="Connect scripts and automations" onPress={() => router.push("/(app)/settings/api-keys")} />
        <Pressable onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
});
