import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, Brain, ChevronRight, Clock, Database, FolderKanban, Inbox, KeyRound, Tag } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { SectionLabel } from "../../../components/ui/primitives";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import AppearanceCard from "../../../components/settings/AppearanceCard";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

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
    <AnimatedPressable
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
      <ChevronRight size={18} color={colors.mutedForeground} />
    </AnimatedPressable>
  );
}

export default function SettingsIndex() {
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
      <MobileHeader title="Settings" back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 4 }}>
        <AnimatedPressable onPress={() => router.push("/(app)/settings/account")} style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name || "Your account"}</Text>
            <Text style={styles.meta}>{user?.email}</Text>
          </View>
          <ChevronRight size={20} color={colors.mutedForeground} />
        </AnimatedPressable>
        <SectionLabel>Make it yours</SectionLabel>
        <AppearanceCard />
        <SectionLabel>Organize</SectionLabel>
        <View style={styles.group}>
          <Row icon={Inbox} title="Inbox" meta="Capture now, organize later" onPress={() => router.push("/(app)/inbox")} />
          <Row icon={Bell} title="Notifications" meta="Reminders, digests, and snooze" onPress={() => router.push("/(app)/notifications")} />
          <Row
            icon={FolderKanban}
            title="Projects"
            meta="List, stages, and project edit"
            onPress={() => router.push("/(app)/projects")}
          />
          <Row
            icon={Tag}
            title="Workspaces"
            meta="Spaces, statuses, labels, and fields"
            onPress={() => router.push("/(app)/settings/workspaces")}
          />
        </View>
        <SectionLabel>Preferences & tools</SectionLabel>
        <View style={styles.group}>
          <Row icon={Bell} title="Notification settings" meta="Push, quiet hours, and failed jobs" onPress={() => router.push("/(app)/settings/notifications")} />
          <Row icon={Brain} title="Report" meta="Weekly summary and focus time" onPress={() => router.push("/(app)/report")} />
          <Row icon={Clock} title="Working hours" meta="When the scheduler can place tasks" onPress={() => router.push("/(app)/settings/schedule")} />
          <Row icon={Database} title="Data & backups" meta="Export, restore, and encrypted backups" onPress={() => router.push("/(app)/settings/data")} />
          <Row icon={KeyRound} title="API keys" meta="Connect scripts and automations" onPress={() => router.push("/(app)/settings/api-keys")} />
        </View>
        <SectionLabel>Assistant help</SectionLabel>
        <Text style={styles.meta}>Pinch inward with two fingers to open the assistant with this screen’s context. Chat history is inside the assistant. Runs continue after closing it. Pinch-to-zoom surfaces keep their normal gesture.</Text>
        <AnimatedPressable onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </AnimatedPressable>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 28,
    backgroundColor: colors.accent,
    padding: 20,
    marginBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.primaryForeground, fontWeight: "700" },
  name: { color: colors.foreground, fontSize: 20, fontWeight: "700" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  group: { backgroundColor: colors.card, borderRadius: 24, padding: 6, gap: 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 68,
    borderRadius: 18,
    paddingHorizontal: 10,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  logout: { alignItems: "center", paddingVertical: 20 },
  logoutText: { color: colors.destructive, fontWeight: "600" },
}));
