import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import { useSaveWorkingHours, useWorkingHoursQuery } from "../../../lib/hooks";
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

  useEffect(() => {
    if (hoursQ.data) setHours(hoursQ.data);
  }, [hoursQ.data]);

  function toggle(day: WeekdayKey) {
    const next = { ...hours.days };
    if (next[day]?.length) delete next[day];
    else next[day] = [{ ...DEFAULT_WINDOW }];
    setHours({ ...hours, days: next });
  }

  function setWindow(day: WeekdayKey, field: "start" | "end", value: string) {
    const current = hours.days[day]?.[0] ?? DEFAULT_WINDOW;
    setHours({
      ...hours,
      days: { ...hours.days, [day]: [{ ...current, [field]: value }] },
    });
  }

  return (
    <Screen>
      <MobileHeader title="Working hours" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Field value={hours.timezone} onChangeText={(timezone) => setHours({ ...hours, timezone })} placeholder="Timezone" />
        {DAYS.map((d) => {
          const on = Boolean(hours.days[d.key]?.length);
          const window = hours.days[d.key]?.[0];
          return (
            <View key={d.key} style={styles.row}>
              <Pressable onPress={() => toggle(d.key)} style={[styles.day, on && styles.dayOn]}>
                <Text style={[styles.dayText, on && { color: colors.accentForeground }]}>{d.label}</Text>
              </Pressable>
              {on && window ? (
                <View style={{ flex: 1, flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Field value={window.start} onChangeText={(v) => setWindow(d.key, "start", v)} placeholder="09:00" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field value={window.end} onChangeText={(v) => setWindow(d.key, "end", v)} placeholder="17:00" />
                  </View>
                </View>
              ) : (
                <Text style={styles.off}>Off</Text>
              )}
            </View>
          );
        })}
        <PrimaryButton
          label={save.isPending ? "Saving…" : "Save hours"}
          disabled={save.isPending}
          onPress={() => save.mutate(hours)}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
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
});
