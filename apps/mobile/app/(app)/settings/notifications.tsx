import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { Bell, BellRing, RotateCcw } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { PrimaryButton } from "../../../components/ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../../../components/settings/SettingsList";
import { TimeField } from "../../../components/ui/DateTimeField";
import {
  getNotificationPermission,
  notificationsSupported,
  registerServerPush,
  requestNotificationPermission,
} from "../../../lib/notifications";
import {
  useDecisionsStatusQuery,
  useFailedJobsQuery,
  useJobHealthQuery,
  useNotificationSettingsQuery,
  useRetryJob,
  useSaveNotificationSettings,
} from "../../../lib/hooks";
import { deviceTimezone } from "../../../lib/format";
import type { NotificationSettings } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function NotificationSettingsScreen() {
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [pushOk, setPushOk] = useState(false);
  const settingsQ = useNotificationSettingsQuery();
  const save = useSaveNotificationSettings();
  const jobs = useFailedJobsQuery();
  const health = useJobHealthQuery();
  const retry = useRetryJob();
  const smart = useDecisionsStatusQuery().data?.available === true;
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
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
        <ListGroup>
          <View style={styles.status}>
            <View style={styles.icon}>
              <Bell size={18} color={granted ? colors.primary : colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Device alerts {granted ? "on" : "off"}</Text>
              <Text style={styles.meta}>
                {!notificationsSupported()
                  ? "Notifications are available on the iOS and Android apps."
                  : granted
                    ? pushOk
                      ? "Reminders arrive from the server even if this app is closed."
                      : "Local reminder fallback is used until a push token can be registered."
                    : "Enable to get a ping when a reminder is due."}
              </Text>
            </View>
          </View>
          {notificationsSupported() && !granted ? (
            <ListRow
              title={canAskAgain ? "Enable notifications" : "Open system settings"}
              tone="add"
              leading={<BellRing size={18} color={colors.primary} />}
              onPress={() => void enable()}
            />
          ) : null}
          {granted ? <ListRow title="System notification settings" onPress={() => void Linking.openSettings()} /> : null}
        </ListGroup>

        {draft ? (
          <>
            <GroupLabel>Send me</GroupLabel>
            <ListGroup>
              <SwitchRow title="Reminders" meta="When a task or event reminder is due" value={draft.reminders} onChange={(reminders) => setDraft({ ...draft, reminders })} />
              <SwitchRow
                title="Morning digest"
                value={draft.digestMorning}
                onChange={(digestMorning) => setDraft({ ...draft, digestMorning, planning: digestMorning })}
              >
                <TimeField compact label="Morning digest" value={draft.morningDigestAt} onChange={(morningDigestAt) => setDraft({ ...draft, morningDigestAt })} />
              </SwitchRow>
              <SwitchRow
                title="Evening recap"
                value={draft.digestEvening}
                onChange={(digestEvening) => setDraft({ ...draft, digestEvening })}
              >
                <TimeField compact label="Evening recap" value={draft.eveningDigestAt} onChange={(eveningDigestAt) => setDraft({ ...draft, eveningDigestAt })} />
              </SwitchRow>
              {smart ? (
                <SwitchRow
                  title="Smart alerts"
                  meta="Up to three a day, from the morning digest time, for work worth acting on now"
                  value={draft.smartAlerts !== false}
                  onChange={(on) => setDraft({ ...draft, smartAlerts: on })}
                />
              ) : null}
            </ListGroup>
            <ListGroup>
              <ListRow
                title="Quiet hours"
                meta={draft.quietHoursStart && draft.quietHoursEnd ? "No pings in between" : "Off"}
                trailing={
                  <View style={styles.pills}>
                    <TimeField compact clearable label="Quiet hours start" placeholder="From" value={draft.quietHoursStart} onChange={(quietHoursStart) => setDraft({ ...draft, quietHoursStart })} />
                    <Text style={styles.dash}>–</Text>
                    <TimeField compact clearable label="Quiet hours end" placeholder="To" value={draft.quietHoursEnd} onChange={(quietHoursEnd) => setDraft({ ...draft, quietHoursEnd })} />
                  </View>
                }
              />
            </ListGroup>
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
          </>
        ) : null}

        <GroupLabel>Background jobs</GroupLabel>
        <ListGroup>
          <ListRow title="Waiting" trailing={<Text style={styles.count}>{health.data?.pending ?? 0}</Text>} />
          <ListRow
            title="Failed"
            trailing={<Text style={[styles.count, (health.data?.failed ?? 0) > 0 && { color: colors.destructive }]}>{health.data?.failed ?? 0}</Text>}
          />
          {(jobs.data ?? []).map((job) => (
            <ListRow
              key={job.id}
              title={`${job.kind} · ${job.attempts}/${job.maxAttempts}`}
              meta={job.lastError || undefined}
              accessibilityLabel={`Retry ${job.kind}`}
              onPress={() => void retry.mutateAsync(job.id)}
              trailing={<RotateCcw size={16} color={colors.primary} />}
              chevron={false}
            />
          ))}
        </ListGroup>
        <GroupHint>Tap a failed reminder or digest to retry it.</GroupHint>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 12, marginTop: 4 },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  dash: { color: colors.mutedForeground, fontSize: 14 },
  count: { color: colors.foreground, fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
}));
