import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bell } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Chip, Field, PrimaryButton } from "../../../components/ui/primitives";
import {
  getNotificationPermission,
  notificationsSupported,
  registerServerPush,
  requestNotificationPermission,
} from "../../../lib/notifications";
import {
  useFailedJobsQuery,
  useJobHealthQuery,
  useNotificationSettingsQuery,
  useRetryJob,
  useSaveNotificationSettings,
} from "../../../lib/hooks";
import { deviceTimezone } from "../../../lib/format";
import type { NotificationSettings } from "../../../lib/types";
import { colors } from "../../../lib/theme";

export default function NotificationSettingsScreen() {
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [pushOk, setPushOk] = useState(false);
  const settingsQ = useNotificationSettingsQuery();
  const save = useSaveNotificationSettings();
  const jobs = useFailedJobsQuery();
  const health = useJobHealthQuery();
  const retry = useRetryJob();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const status = await getNotificationPermission();
    setGranted(status.granted);
    setCanAskAgain(status.canAskAgain);
    if (status.granted) {
      setPushOk(await registerServerPush());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (settingsQ.data) {
      setDraft({ ...settingsQ.data, timezone: settingsQ.data.timezone || deviceTimezone() });
    }
  }, [settingsQ.data]);

  async function enable() {
    const ok = await requestNotificationPermission();
    setGranted(ok);
    if (ok) setPushOk(await registerServerPush());
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
            <Text style={styles.title}>Device alerts</Text>
            <Text style={styles.meta}>
              {!notificationsSupported()
                ? "Notifications are available on the iOS and Android apps."
                : granted
                  ? pushOk
                    ? "On. Reminders arrive from the server even if this app is closed."
                    : "On. Local reminder fallback is used until a push token can be registered."
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

        {draft ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.section}>Preferences</Text>
            <View style={styles.row}>
              <Chip label="Reminders" active={draft.reminders} onPress={() => setDraft({ ...draft, reminders: !draft.reminders })} />
              <Chip
                label="Morning digest"
                active={draft.digestMorning}
                onPress={() => setDraft({ ...draft, digestMorning: !draft.digestMorning, planning: !draft.digestMorning })}
              />
              <Chip
                label="Evening recap"
                active={draft.digestEvening}
                onPress={() => setDraft({ ...draft, digestEvening: !draft.digestEvening })}
              />
            </View>
            <Field value={draft.morningDigestAt} onChangeText={(morningDigestAt) => setDraft({ ...draft, morningDigestAt })} placeholder="Morning HH:mm" />
            <Field value={draft.eveningDigestAt} onChangeText={(eveningDigestAt) => setDraft({ ...draft, eveningDigestAt })} placeholder="Evening HH:mm" />
            <Field value={draft.quietHoursStart} onChangeText={(quietHoursStart) => setDraft({ ...draft, quietHoursStart })} placeholder="Quiet start HH:mm" />
            <Field value={draft.quietHoursEnd} onChangeText={(quietHoursEnd) => setDraft({ ...draft, quietHoursEnd })} placeholder="Quiet end HH:mm" />
            <PrimaryButton
              label={save.isPending ? "Saving…" : "Save preferences"}
              disabled={save.isPending}
              onPress={() => {
                setMessage("");
                void save.mutateAsync({ ...draft, planning: draft.digestMorning }).then(() => setMessage("Saved."));
              }}
            />
            {message ? <Text style={styles.hint}>{message}</Text> : null}
            {save.isError ? (
              <Text style={styles.error}>{save.error instanceof Error ? save.error.message : "Could not save."}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Text style={styles.section}>Background jobs</Text>
          <Text style={styles.hint}>
            Pending {health.data?.pending ?? 0}, failed {health.data?.failed ?? 0}. Retry a failed reminder or digest here.
          </Text>
          {(jobs.data ?? []).map((job) => (
            <Pressable key={job.id} onPress={() => void retry.mutateAsync(job.id)} style={styles.job}>
              <Text style={styles.title}>
                {job.kind} · {job.attempts}/{job.maxAttempts}
              </Text>
              {job.lastError ? <Text style={styles.error}>{job.lastError}</Text> : null}
              <Text style={styles.linkText}>Retry</Text>
            </Pressable>
          ))}
        </View>
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
  error: { color: colors.destructive, fontSize: 12, marginTop: 4 },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  job: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.card,
  },
});
