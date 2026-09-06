import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bell } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { PrimaryButton } from "../../../components/ui/primitives";
import {
  getNotificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from "../../../lib/notifications";
import { colors } from "../../../lib/theme";

export default function NotificationSettings() {
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const refresh = useCallback(async () => {
    const status = await getNotificationPermission();
    setGranted(status.granted);
    setCanAskAgain(status.canAskAgain);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    const ok = await requestNotificationPermission();
    setGranted(ok);
    if (!ok) {
      const status = await getNotificationPermission();
      setCanAskAgain(status.canAskAgain);
      if (!status.canAskAgain) void Linking.openSettings();
    }
  }

  return (
    <Screen>
      <MobileHeader title="Notifications" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Bell size={18} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Reminders</Text>
            <Text style={styles.meta}>
              {!notificationsSupported()
                ? "Notifications are available on the iOS and Android apps."
                : granted
                  ? "On. Reminders ping at the time you set."
                  : "Off. Enable to get a ping when a reminder is due."}
            </Text>
          </View>
        </View>
        {notificationsSupported() && !granted ? (
          <PrimaryButton label={canAskAgain ? "Enable notifications" : "Open system settings"} onPress={() => void enable()} />
        ) : null}
        {granted ? (
          <Pressable onPress={() => void Linking.openSettings()} style={styles.link}>
            <Text style={styles.linkText}>System notification settings</Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>
          Reminder pings are scheduled on this device from your calendar. Recurring reminders notify on each upcoming occurrence. Work tasks stay on the calendar and do not ping.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 13, marginTop: 4 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
});
