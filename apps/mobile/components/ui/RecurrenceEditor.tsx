import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Repeat2 } from "lucide-react-native";
import { Chip } from "./primitives";
import TaskSectionHeader from "../tasks/TaskSectionHeader";
import DateTimeSheet from "./DateTimeSheet";
import {
  LAST_DAY,
  describeRRule,
  draftToPreset,
  draftToRRule,
  monthLabel,
  ordinal,
  ordinalWeek,
  presetToDraft,
  weekdayLabel,
  withFreq,
  type RecurrenceDraft,
  type RecurrenceFreq,
  type RecurrencePreset,
} from "../../lib/recurrence";
import { formatShortDate } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const PRESETS: RecurrencePreset[] = ["none", "daily", "weekly", "weekdays", "monthly", "yearly", "custom"];
const FREQS: { value: RecurrenceFreq; label: string }[] = [
  { value: "DAILY", label: "day(s)" },
  { value: "WEEKLY", label: "week(s)" },
  { value: "MONTHLY", label: "month(s)" },
  { value: "YEARLY", label: "year(s)" },
];

function presetLabel(preset: RecurrencePreset, anchor: Date) {
  switch (preset) {
    case "none":
      return "Does not repeat";
    case "daily":
      return "Daily";
    case "weekly":
      return `Weekly on ${weekdayLabel(anchor.getDay(), true)}`;
    case "weekdays":
      return "Every weekday";
    case "monthly":
      return `Monthly on the ${ordinal(anchor.getDate())}`;
    case "yearly":
      return `Yearly on ${monthLabel(anchor.getMonth() + 1)} ${anchor.getDate()}`;
    case "custom":
      return "Custom…";
  }
}

export default function RecurrenceEditor({
  value,
  onChange,
  anchor,
}: {
  value: RecurrenceDraft | null;
  onChange: (draft: RecurrenceDraft | null) => void;
  anchor: Date;
}) {
  const matched = draftToPreset(value, anchor);
  const [customOpen, setCustomOpen] = useState(matched === "custom");
  const [pickingUntil, setPickingUntil] = useState(false);
  const showCustom = value !== null && (customOpen || matched === "custom" || matched === "weekly");

  function update(patch: Partial<RecurrenceDraft>) {
    if (!value) return;
    onChange({ ...value, ...patch });
  }

  function untilDate() {
    return value?.end.type === "until" && value.end.date ? new Date(`${value.end.date}T00:00:00`) : null;
  }

  return (
    <View style={styles.root}>
      <TaskSectionHeader
        icon={<Repeat2 size={18} color={colors.accentForeground} />}
        title="Repeat Cadence"
        subtitle="Automate recurring placement"
        badge={value ? presetLabel(matched, anchor) : "Off"}
        badgeTone={value ? "primary" : "muted"}
      />
      <View style={styles.wrap}>
        {PRESETS.map((preset) => (
          <Chip
            key={preset}
            label={presetLabel(preset, anchor)}
            active={matched === preset || (preset === "custom" && showCustom && matched === "custom")}
            onPress={() => {
              setCustomOpen(preset === "custom");
              if (preset === "custom" && value) return;
              onChange(presetToDraft(preset, anchor));
            }}
          />
        ))}
      </View>

      {showCustom && value ? (
        <View style={styles.panel}>
          <Text style={styles.muted}>Every</Text>
          <View style={styles.row}>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => update({ interval: Math.max(1, value.interval - 1) })}
                style={styles.step}
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.stepValue}>{value.interval}</Text>
              <Pressable
                onPress={() => update({ interval: Math.min(999, value.interval + 1) })}
                style={styles.step}
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
            <View style={styles.wrap}>
              {FREQS.map((freq) => (
                <Chip
                  key={freq.value}
                  label={freq.label}
                  active={value.freq === freq.value}
                  onPress={() => onChange(withFreq(value, freq.value, anchor))}
                />
              ))}
            </View>
          </View>

          {value.freq === "WEEKLY" ? (
            <>
              <Text style={styles.muted}>On</Text>
              <View style={styles.wrap}>
                {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                  const active = value.byDay.includes(day);
                  return (
                    <Chip
                      key={day}
                      label={weekdayLabel(day).slice(0, 2)}
                      active={active}
                      onPress={() => {
                        const next = active ? value.byDay.filter((d) => d !== day) : [...value.byDay, day];
                        update({ byDay: next.length ? next : [day] });
                      }}
                    />
                  );
                })}
              </View>
            </>
          ) : null}

          {value.freq === "MONTHLY" ? (
            <>
              <View style={styles.wrap}>
                <Chip
                  label="On these dates"
                  active={value.monthlyMode === "day"}
                  onPress={() => update({ monthlyMode: "day" })}
                />
                <Chip
                  label={`On the ${ordinalWeek(anchor)} ${weekdayLabel(anchor.getDay(), true)}`}
                  active={value.monthlyMode === "weekday"}
                  onPress={() => update({ monthlyMode: "weekday" })}
                />
              </View>
              {value.monthlyMode === "day" ? (
                <MonthDayGrid value={value.byMonthDay} onChange={(byMonthDay) => update({ byMonthDay })} />
              ) : null}
            </>
          ) : null}

          {value.freq === "YEARLY" ? (
            <>
              <Text style={styles.muted}>In</Text>
              <View style={styles.wrap}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const active = value.byMonth.includes(month);
                  return (
                    <Chip
                      key={month}
                      label={monthLabel(month)}
                      active={active}
                      onPress={() => {
                        const next = active ? value.byMonth.filter((m) => m !== month) : [...value.byMonth, month];
                        update({ byMonth: next.length ? next : [month] });
                      }}
                    />
                  );
                })}
              </View>
              <Text style={styles.muted}>On these dates</Text>
              <MonthDayGrid value={value.byMonthDay} onChange={(byMonthDay) => update({ byMonthDay })} />
            </>
          ) : null}

          <Text style={styles.muted}>Ends</Text>
          <View style={styles.wrap}>
            <Chip label="Never" active={value.end.type === "never"} onPress={() => update({ end: { type: "never" } })} />
            <Chip
              label={
                value.end.type === "until" && value.end.date
                  ? `On ${formatShortDate(`${value.end.date}T00:00:00`)}`
                  : "On a date"
              }
              active={value.end.type === "until"}
              onPress={() => {
                update({
                  end: {
                    type: "until",
                    date: value.end.type === "until" ? value.end.date : "",
                  },
                });
                setPickingUntil(true);
              }}
            />
            <Chip
              label={value.end.type === "count" ? `After ${value.end.count} times` : "After n times"}
              active={value.end.type === "count"}
              onPress={() => update({ end: { type: "count", count: value.end.type === "count" ? value.end.count : 10 } })}
            />
          </View>
          {value.end.type === "count" ? (
            <CountStepper
              count={value.end.count}
              onChange={(count) => update({ end: { type: "count", count } })}
            />
          ) : null}

          <Text style={styles.summary}>{describeRRule(draftToRRule(value, anchor), anchor)}</Text>
        </View>
      ) : null}

      <DateTimeSheet
        open={pickingUntil}
        value={untilDate()}
        mode="date"
        onClose={() => setPickingUntil(false)}
        onChange={(next) => {
          if (!next) {
            update({ end: { type: "never" } });
            return;
          }
          const y = next.getFullYear();
          const m = String(next.getMonth() + 1).padStart(2, "0");
          const d = String(next.getDate()).padStart(2, "0");
          update({ end: { type: "until", date: `${y}-${m}-${d}` } });
        }}
      />
    </View>
  );
}

function CountStepper({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(1, count - 1))} style={styles.step}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{count}</Text>
      <Pressable onPress={() => onChange(Math.min(999, count + 1))} style={styles.step}>
        <Text style={styles.stepText}>+</Text>
      </Pressable>
      <Text style={styles.muted}>times</Text>
    </View>
  );
}

function MonthDayGrid({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(day: number) {
    const active = value.includes(day);
    const next = active ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.length ? next : [day]);
  }

  return (
    <View style={styles.wrap}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
        <Chip key={day} label={String(day)} active={value.includes(day)} onPress={() => toggle(day)} />
      ))}
      <Chip label="Last day" active={value.includes(LAST_DAY)} onPress={() => toggle(LAST_DAY)} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { gap: 14, borderRadius: 24, backgroundColor: colors.card, padding: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { gap: 8 },
  panel: { gap: 12, borderRadius: 18, backgroundColor: colors.background, padding: 14 },
  muted: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: {
    width: 40,
    height: 40,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.foreground, fontSize: 18, fontWeight: "600" },
  stepValue: { color: colors.primary, fontSize: 18, fontWeight: "800", minWidth: 24, textAlign: "center" },
  summary: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
}));
