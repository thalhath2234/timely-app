import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, Clock, Database, KeyRound, Palette, Tag, UserRound } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function SettingsIndex() {
  const router = useRouter();
  const { logout } = useAuth();
  const rows = [
    { href: "/(app)/settings/account", title: "Account", meta: "Name, email, password", Icon: UserRound },
    { href: "/(app)/(tabs)/more", title: "Appearance", meta: "Theme, accent, and account look", Icon: Palette },
    { href: "/(app)/settings/notifications", title: "Notifications", meta: "Push, quiet hours, and digests", Icon: Bell },
    { href: "/(app)/settings/schedule", title: "Schedule", meta: "Hours, freeze, and engine", Icon: Clock },
    { href: "/(app)/settings/workspaces", title: "Workspaces", meta: "Statuses, labels, custom fields", Icon: Tag },
    { href: "/(app)/settings/data", title: "Data & backups", meta: "Export, restore, and encrypted backups", Icon: Database },
    { href: "/(app)/settings/api-keys", title: "API keys", meta: "Automations and MCP", Icon: KeyRound },
  ] as const;

  return (
    <Screen>
      <MobileHeader title="Settings" back />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        {rows.map((row) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${row.title}. ${row.meta}`} key={row.href} onPress={() => router.push(row.href as never)} style={styles.card}>
            <View style={styles.icon}>
              <row.Icon size={18} color={colors.mutedForeground} />
            </View>
            <View>
              <Text style={styles.title}>{row.title}</Text>
              <Text style={styles.meta}>{row.meta}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
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
  },
  icon: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  logout: { alignItems: "center", paddingVertical: 20 },
  logoutText: { color: colors.destructive, fontWeight: "600" },
}));
