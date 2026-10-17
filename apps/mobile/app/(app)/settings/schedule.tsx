import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Button, Field, PrimaryButton, Select } from "../../../components/ui/primitives";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import { ColorDot, GroupLabel, ListGroup, ListRow, ListSwitch } from "../../../components/settings/SettingsList";
import { Plus, X } from "lucide-react-native";
import {
  useSaveScheduleSettings,
  useSaveWorkingHours,
  useScheduleSettingsQuery,
  useWorkspacesQuery,
  useWorkingHoursQuery,
} from "../../../lib/hooks";
import { deviceTimezone, listTimezones } from "../../../lib/format";
import { TimeField } from "../../../components/ui/DateTimeField";
import type { WeekdayKey, WorkingHours, WorkingWindow } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";

const DAYS: { key: WeekdayKey; label: string; name: string }[] = [
  { key: "mon", label: "Mon", name: "Monday" },
  { key: "tue", label: "Tue", name: "Tuesday" },
  { key: "wed", label: "Wed", name: "Wednesday" },
  { key: "thu", label: "Thu", name: "Thursday" },
  { key: "fri", label: "Fri", name: "Friday" },
  { key: "sat", label: "Sat", name: "Saturday" },
  { key: "sun", label: "Sun", name: "Sunday" },
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
      <FocusGroupScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {hoursQ.isError ? (
          <Text style={styles.error}>Could not load working hours.</Text>
        ) : null}
        <ListGroup>
          <Select
            trigger="row"
            label="Timezone"
            searchable
            value={hours.timezone}
            onChange={(timezone) => setHours({ ...hours, timezone })}
            options={listTimezones(hours.timezone).map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }))}
          />
        </ListGroup>
        <GroupLabel>Working hours</GroupLabel>
        <ListGroup>
          {DAYS.map((d) => {
            const windows = hours.days[d.key] ?? [];
            const on = windows.length > 0;
            return (
              <View key={d.key} style={styles.day}>
                {(on ? windows : [null]).map((window, index) => (
                  <View key={`${d.key}-${index}`} style={styles.dayLine}>
                    <Text style={[styles.dayLabel, !on && styles.dayOff]} accessibilityLabel={d.name}>
                      {index === 0 ? d.label : ""}
                    </Text>
                    {window ? (
                      <View style={styles.windowPills}>
                        <TimeField compact label={`${d.name} start`} value={window.start} onChange={(v) => setWindow(d.key, index, "start", v)} />
                        <Text style={styles.dash}>–</Text>
                        <TimeField compact label={`${d.name} end`} value={window.end} onChange={(v) => setWindow(d.key, index, "end", v)} />
                      </View>
                    ) : (
                      <Text style={[styles.windowPills, styles.offText]}>Off</Text>
                    )}
                    {index === 0 ? (
                      <>
                        {on ? (
                          <Button
                            label={`Add a ${d.name} window`}
                            variant="ghost"
                            size="sm"
                            iconOnly
                            icon={<Plus size={16} color={colors.mutedForeground} />}
                            onPress={() => addWindow(d.key)}
                          />
                        ) : null}
                        <ListSwitch label={`Work on ${d.name}`} value={on} onChange={() => toggle(d.key)} />
                      </>
                    ) : (
                      <Button
                        label={`Remove ${d.name} window ${index + 1}`}
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={<X size={16} color={colors.mutedForeground} />}
                        onPress={() => removeWindow(d.key, index)}
                      />
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </ListGroup>
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
      </FocusGroupScrollView>
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
  const [picking, setPicking] = useState(false);

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
    <FocusGroup style={{ gap: 12, marginTop: 8 }}>
      <GroupLabel>Auto-schedule</GroupLabel>
      {settingsQ.isError ? <Text style={styles.error}>Could not load engine settings.</Text> : null}
      <ListGroup>
        <ListRow
          title="Buffer between blocks"
          meta="1–60 minutes"
          trailing={
            <View style={styles.numberRow}>
              <View style={styles.number}>
                <Field bare value={breakMinutes} onChangeText={setBreakMinutes} placeholder="5" keyboardType="number-pad" />
              </View>
              <Text style={styles.unit}>min</Text>
            </View>
          }
        />
        <ListRow
          title="Don't move the next"
          meta="0–168 hours stay as planned"
          trailing={
            <View style={styles.numberRow}>
              <View style={styles.number}>
                <Field bare value={freezeHours} onChangeText={setFreezeHours} placeholder="0" keyboardType="number-pad" />
              </View>
              <Text style={styles.unit}>h</Text>
            </View>
          }
        />
        {spaces.length > 0 ? (
          <ListRow
            title="Skip workspaces"
            trailing={
              excluded.length
                ? spaces.filter((space) => excluded.includes(space.id)).map((space) => space.name).join(", ")
                : "None"
            }
            onPress={() => setPicking(true)}
          />
        ) : null}
      </ListGroup>
      <BottomSheet open={picking} onClose={() => setPicking(false)} title="Skip workspaces" subtitle="The scheduler won't place their tasks">
        {spaces.map((space) => (
          <SheetOption
            key={space.id}
            selected={excluded.includes(space.id)}
            leading={space.color ? <ColorDot color={space.color} size={8} /> : undefined}
            onSelect={() => toggle(space.id)}
          >
            {space.name}
          </SheetOption>
        ))}
      </BottomSheet>
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
    </FocusGroup>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  day: { paddingHorizontal: 14, paddingVertical: 6, gap: 2 },
  dayLine: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 },
  dayLabel: { width: 40, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  dayOff: { color: colors.mutedForeground, fontWeight: "500" },
  windowPills: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  offText: { color: colors.mutedForeground, fontSize: 14 },
  dash: { color: colors.mutedForeground, fontSize: 14 },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  number: { width: 52, minHeight: 32, borderRadius: 8, backgroundColor: colors.muted, paddingHorizontal: 10, justifyContent: "center" },
  unit: { width: 24, color: colors.mutedForeground, fontSize: 13 },
  msg: { color: colors.mutedForeground, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 13 },
}));
