import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Chip, Field, PrimaryButton } from "../../../components/ui/primitives";
import {
  useSaveScheduleSettings,
  useSaveWorkingHours,
  useScheduleSettingsQuery,
  useWorkspacesQuery,
  useWorkingHoursQuery,
} from "../../../lib/hooks";
import { deviceTimezone } from "../../../lib/format";
import type { WeekdayKey, WorkingHours, WorkingWindow } from "../../../lib/types";
import { colors } from "../../../lib/theme";

const DAYS: { key: WeekdayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const DEFAULT_WINDOW: WorkingWindow = { start: "09:00", end: "17:00" };

export default function ScheduleSettings() {
  const hoursQ = useWorkingHoursQuery();
  const save = useSaveWorkingHours();
  const [hours, setHours] = useState<WorkingHours>({ timezone: deviceTimezone(), days: {} });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (hoursQ.data) setHours(hoursQ.data);
  }, [hoursQ.data]);

  function toggle(day: WeekdayKey) {
    const next = { ...hours.days };
    if (next[day]?.length) delete next[day];
    else next[day] = [{ ...DEFAULT_WINDOW }];
    setHours({ ...hours, days: next });
  }

  function setWindow(day: WeekdayKey, index: number, field: "start" | "end", value: string) {
    const current = [...(hours.days[day] ?? [{ ...DEFAULT_WINDOW }])];
    current[index] = { ...current[index], [field]: value };
    setHours({ ...hours, days: { ...hours.days, [day]: current } });
  }

  function addWindow(day: WeekdayKey) {
    const current = hours.days[day] ?? [{ ...DEFAULT_WINDOW }];
    setHours({ ...hours, days: { ...hours.days, [day]: [...current, { start: "13:00", end: "17:00" }] } });
  }

  function removeWindow(day: WeekdayKey, index: number) {
    const current = (hours.days[day] ?? []).filter((_, i) => i !== index);
    const next = { ...hours.days };
    if (current.length) next[day] = current;
    else delete next[day];
    setHours({ ...hours, days: next });
  }

  return (
    <Screen>
      <MobileHeader title="Schedule" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {hoursQ.isError ? (
          <Text style={styles.error}>Could not load working hours.</Text>
        ) : null}
        <Field value={hours.timezone} onChangeText={(timezone) => setHours({ ...hours, timezone })} placeholder="Timezone (IANA)" />
        {DAYS.map((d) => {
          const windows = hours.days[d.key] ?? [];
          const on = windows.length > 0;
          return (
            <View key={d.key} style={styles.block}>
              <View style={styles.row}>
                <Pressable onPress={() => toggle(d.key)} style={[styles.day, on && styles.dayOn]}>
                  <Text style={[styles.dayText, on && { color: colors.accentForeground }]}>{d.label}</Text>
                </Pressable>
                {on ? (
                  <Pressable onPress={() => addWindow(d.key)}>
                    <Text style={styles.link}>Add window</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.off}>Off</Text>
                )}
              </View>
              {windows.map((window, index) => (
                <View key={`${d.key}-${index}`} style={styles.windowRow}>
                  <View style={{ flex: 1 }}>
                    <Field value={window.start} onChangeText={(v) => setWindow(d.key, index, "start", v)} placeholder="09:00" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field value={window.end} onChangeText={(v) => setWindow(d.key, index, "end", v)} placeholder="17:00" />
                  </View>
                  <Pressable onPress={() => removeWindow(d.key, index)}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })}
        {message ? <Text style={styles.msg}>{message}</Text> : null}
        <PrimaryButton
          label={save.isPending ? "Saving…" : "Save hours"}
          disabled={save.isPending}
          onPress={() => {
            setMessage("");
            save.mutate(hours, {
              onSuccess: () => setMessage("Saved"),
              onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
            });
          }}
        />
        <EngineSettings />
      </ScrollView>
    </Screen>
  );
}

function EngineSettings() {
  const settingsQ = useScheduleSettingsQuery();
  const save = useSaveScheduleSettings();
  const spaces = useWorkspacesQuery().data ?? [];
  const [breakMinutes, setBreakMinutes] = useState("5");
  const [freezeHours, setFreezeHours] = useState("0");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settingsQ.data) return;
    setBreakMinutes(String(settingsQ.data.breakMinutes ?? 5));
    setFreezeHours(String(settingsQ.data.freezeHours ?? 0));
    setExcluded(settingsQ.data.excludedWorkspaceIds ?? []);
  }, [settingsQ.data]);

  function toggle(id: string) {
    setExcluded((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <View style={{ gap: 12, marginTop: 20 }}>
      <Text style={styles.heading}>Engine</Text>
      <Text style={styles.hint}>
        Buffer sits between placed blocks. Freeze keeps the next hours from being rewritten.
      </Text>
      {settingsQ.isError ? <Text style={styles.error}>Could not load engine settings.</Text> : null}
      <Field
        value={breakMinutes}
        onChangeText={setBreakMinutes}
        placeholder="Buffer minutes (1–60)"
        keyboardType="number-pad"
      />
      <Field
        value={freezeHours}
        onChangeText={setFreezeHours}
        placeholder="Freeze next hours (0–168)"
        keyboardType="number-pad"
      />
      {spaces.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.hint}>Exclude workspaces</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {spaces.map((space) => (
              <Chip
                key={space.id}
                label={space.name}
                active={excluded.includes(space.id)}
                onPress={() => toggle(space.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      <PrimaryButton
        label={save.isPending ? "Saving…" : "Save engine settings"}
        disabled={save.isPending}
        onPress={() => {
          setMessage("");
          const breakValue = Number(breakMinutes);
          const freezeValue = Number(freezeHours);
          if (!Number.isFinite(breakValue) || breakValue < 1 || breakValue > 60) {
            setMessage("Buffer must be 1–60 minutes");
            return;
          }
          if (!Number.isFinite(freezeValue) || freezeValue < 0 || freezeValue > 168) {
            setMessage("Freeze must be 0–168 hours");
            return;
          }
          save.mutate(
            {
              breakMinutes: Math.round(breakValue),
              freezeHours: Math.round(freezeValue),
              excludedWorkspaceIds: excluded,
            },
            {
              onSuccess: () => setMessage("Engine settings saved"),
              onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
            },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  windowRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 66 },
  day: {
    width: 56,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.primary },
  dayText: { color: colors.mutedForeground, fontWeight: "600" },
  off: { color: colors.mutedForeground },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  remove: { color: colors.destructive, fontSize: 12 },
  heading: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.mutedForeground, fontSize: 13 },
  msg: { color: colors.mutedForeground, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 13 },
});
