import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, BellRing, RotateCcw } from "lucide-react-native";
import { HIDDEN_PUSH_BODY, jobKindLabel } from "@timely/contract/notifications";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { PrimaryButton } from "../../../components/ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../../../components/settings/SettingsList";
import { TimeField } from "../../../components/ui/DateTimeField";
import { AlertDefaults } from "../../../components/bots/BotsEmpty";
import {
  getNotificationPermission,
  notificationsSupported,
  registerServerPushState,
  requestNotificationPermission,
  type PushState,
} from "../../../lib/notifications";
import { instantPushLine } from "../../../lib/pushStatus";
import {
  useDecisionsStatusQuery,
  useFailedJobsQuery,
  useJobHealthQuery,
  useNotificationSettingsQuery,
  useRetryJob,
  useSaveNotificationSettings,
  useSetPushTextHidden,
} from "../../../lib/hooks";
import { deviceTimezone } from "../../../lib/format";
import type { NotificationSettings } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

/** True when two settings differ in nothing but "Hide alert text in push", which saves on its own. */
function onlyPushTextChanged(a: NotificationSettings, b: NotificationSettings) {
  const rest = (s: NotificationSettings) => {
    const { hidePushText: _hidden, ...other } = s;
    return JSON.stringify(Object.entries(other).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  };
  return rest(a) === rest(b);
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const settingsQ = useNotificationSettingsQuery();
  const save = useSaveNotificationSettings();
  const pushText = useSetPushTextHidden();
  const [pushTextError, setPushTextError] = useState("");
  const jobs = useFailedJobsQuery();
  const health = useJobHealthQuery();
  const retry = useRetryJob();
  const smart = useDecisionsStatusQuery().data?.available === true;
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [message, setMessage] = useState("");
  const [retryError, setRetryError] = useState("");

  async function retryJob(id: string) {
    setRetryError("");
    try {
      await retry.mutateAsync(id);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Couldn’t retry this job.");
    }
  }

  const refresh = useCallback(async () => {
    const status = await getNotificationPermission();
    setGranted(status.granted);
    setCanAskAgain(status.canAskAgain);
    if (status.granted) setPushState(await registerServerPushState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset the form when the saved settings change, except when only "Hide
  // alert text in push" did: that switch saves on its own and must not wipe
  // edits the person has not saved yet.
  const lastSettings = useRef<NotificationSettings | null>(null);
  useEffect(() => {
    const data = settingsQ.data;
    if (!data) return;
    const previous = lastSettings.current;
    lastSettings.current = data;
    if (previous && onlyPushTextChanged(previous, data)) return;
    setDraft({ ...data, timezone: data.timezone || deviceTimezone() });
  }, [settingsQ.data]);

  function setPushTextHidden(hidden: boolean) {
    setPushTextError("");
    pushText.mutate(hidden, {
      onError: (err) => setPushTextError(err instanceof Error ? err.message : "Couldn’t save this setting."),
    });
  }

  async function enable() {
    const ok = await requestNotificationPermission();
    setGranted(ok);
    if (ok) setPushState(await registerServerPushState());
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
                    ? "Timely can show alerts on this phone."
                    : "Enable to get a ping when a reminder is due."}
              </Text>
            </View>
          </View>
          {notificationsSupported() && granted && pushState ? (
            <ListRow title="Instant push" trailing={pushState === "on" ? "On" : "Off"} />
          ) : null}
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
        {notificationsSupported() && granted && pushState ? <GroupHint>{instantPushLine(pushState)}</GroupHint> : null}

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

        <GroupLabel>Bots</GroupLabel>
        <AlertDefaults label="Alerts for new bots">
          <ListRow title="Open Bots" onPress={() => router.push("/(app)/(tabs)/bots")} />
        </AlertDefaults>
        <GroupHint>Each bot has its own alerts. These are what new bots start with.</GroupHint>
        {settingsQ.data ? (
          <>
            <ListGroup>
              <SwitchRow
                title="Hide alert text in push"
                meta={`Phones show “${HIDDEN_PUSH_BODY}”`}
                value={pushText.isPending ? pushText.variables === true : settingsQ.data.hidePushText === true}
                onChange={(hidden) => {
                  if (!pushText.isPending) setPushTextHidden(hidden);
                }}
              />
            </ListGroup>
            {pushTextError ? <Text style={styles.retryNote}>{pushTextError}</Text> : null}
            <GroupHint>
              Expo and Google carry what a push says. With this on, they only carry “{HIDDEN_PUSH_BODY}”; the alert opens in
              Timely.
            </GroupHint>
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
              title={`${jobKindLabel(job.kind)} · ${job.attempts} of ${job.maxAttempts} tries`}
              meta={job.lastError || undefined}
              accessibilityLabel={`Retry ${jobKindLabel(job.kind)}`}
              onPress={() => void retryJob(job.id)}
              disabled={retry.isPending}
              trailing={<RotateCcw size={16} color={colors.primary} />}
              chevron={false}
            />
          ))}
        </ListGroup>
        {retryError ? <Text style={styles.retryNote}>{retryError}</Text> : null}
        <GroupHint>
          Tap a failed job to run it again. Smart alerts and search index jobs use your AI provider again.
        </GroupHint>
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
  retryNote: { color: colors.foreground, fontSize: 12, marginTop: 8, paddingHorizontal: 4 },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  dash: { color: colors.mutedForeground, fontSize: 14 },
  count: { color: colors.foreground, fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
}));
