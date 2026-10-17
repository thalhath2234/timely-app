import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { SheetOption } from "./BottomSheet";
import SegmentedControl from "./SegmentedControl";
import DateTimeSheet from "./DateTimeSheet";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
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
  { value: "DAILY", label: "Days" },
  { value: "WEEKLY", label: "Weeks" },
  { value: "MONTHLY", label: "Months" },
  { value: "YEARLY", label: "Years" },
];
type EndType = "never" | "until" | "count";

export function presetLabel(preset: RecurrencePreset, anchor: Date) {
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

/**
 * The Repeat page (`RepeatRow`): the presets as options, and for Custom a
 * grouped card (Every, On, Ends) like the rest of the form
 * (docs/design-system.md#sheets-and-create-forms).
 */
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
  const showCustom = value !== null && (customOpen || matched === "custom");
  const selected: RecurrencePreset = showCustom ? "custom" : matched;

  function update(patch: Partial<RecurrenceDraft>) {
    if (!value) return;
    onChange({ ...value, ...patch });
  }

  function untilDate() {
    return value?.end.type === "until" && value.end.date ? new Date(`${value.end.date}T00:00:00`) : null;
  }

  return (
    <View style={styles.root}>
      <View>
        {PRESETS.map((preset) => (
          <SheetOption
            key={preset}
            selected={selected === preset}
            onSelect={() => {
              setCustomOpen(preset === "custom");
              if (preset === "custom" && value) return;
              onChange(presetToDraft(preset, anchor));
            }}
          >
            {presetLabel(preset, anchor)}
          </SheetOption>
        ))}
      </View>

      {showCustom && value ? (
        <View style={styles.section}>
          <GroupLabel>Custom</GroupLabel>
          <ListGroup>
            <ListRow
              title="Every"
              trailing={
                <Stepper
                  value={value.interval}
                  label={value.interval === 1 ? FREQS.find((f) => f.value === value.freq)!.label.slice(0, -1).toLowerCase() : FREQS.find((f) => f.value === value.freq)!.label.toLowerCase()}
                  onChange={(interval) => update({ interval })}
                />
              }
            />
            <ListRow
              title="Unit"
              trailing={
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Repeat unit"
                  options={FREQS}
                  value={value.freq}
                  onChange={(freq) => onChange(withFreq(value, freq, anchor))}
                />
              }
            />
            {value.freq === "WEEKLY" ? (
              <ListRow
                title="On"
                trailing={
                  <View style={styles.dots}>
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                      const active = value.byDay.includes(day);
                      return (
                        <DayDot
                          key={day}
                          label={weekdayLabel(day).slice(0, 1)}
                          accessibilityLabel={weekdayLabel(day)}
                          active={active}
                          onPress={() => {
                            const next = active ? value.byDay.filter((d) => d !== day) : [...value.byDay, day];
                            update({ byDay: next.length ? next : [day] });
                          }}
                        />
                      );
                    })}
                  </View>
                }
              />
            ) : null}
            {value.freq === "MONTHLY" ? (
              <ListRow
                title="By"
                trailing={
                  <SegmentedControl
                    size="sm"
                    accessibilityLabel="Monthly by"
                    options={[
                      { label: "Dates", value: "day" },
                      { label: `${ordinalWeek(anchor)} ${weekdayLabel(anchor.getDay(), true)}`, value: "weekday" },
                    ]}
                    value={value.monthlyMode}
                    onChange={(monthlyMode) => update({ monthlyMode })}
                  />
                }
              />
            ) : null}
            {value.freq === "MONTHLY" && value.monthlyMode === "day" ? (
              <View>
                <MonthDayGrid value={value.byMonthDay} onChange={(byMonthDay) => update({ byMonthDay })} />
              </View>
            ) : null}
            {value.freq === "YEARLY" ? (
              <View>
                <Text style={styles.gridLabel}>In</Text>
                <View style={styles.grid}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                    const active = value.byMonth.includes(month);
                    return (
                      <Cell
                        key={month}
                        label={monthLabel(month)}
                        wide
                        active={active}
                        onPress={() => {
                          const next = active ? value.byMonth.filter((m) => m !== month) : [...value.byMonth, month];
                          update({ byMonth: next.length ? next : [month] });
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
            {value.freq === "YEARLY" ? (
              <View>
                <Text style={styles.gridLabel}>On</Text>
                <MonthDayGrid value={value.byMonthDay} onChange={(byMonthDay) => update({ byMonthDay })} />
              </View>
            ) : null}
            <ListRow
              title="Ends"
              trailing={
                <SegmentedControl<EndType>
                  size="sm"
                  accessibilityLabel="Ends"
                  options={[
                    { label: "Never", value: "never" },
                    { label: "On date", value: "until" },
                    { label: "After", value: "count" },
                  ]}
                  value={value.end.type}
                  onChange={(type) => {
                    if (type === "never") update({ end: { type: "never" } });
                    if (type === "until") {
                      update({ end: { type: "until", date: value.end.type === "until" ? value.end.date : "" } });
                      setPickingUntil(true);
                    }
                    if (type === "count") update({ end: { type: "count", count: value.end.type === "count" ? value.end.count : 10 } });
                  }}
                />
              }
            />
            {value.end.type === "until" ? (
              <ListRow
                title="End date"
                trailing={value.end.date ? formatShortDate(`${value.end.date}T00:00:00`) : "Pick a date"}
                onPress={() => setPickingUntil(true)}
              />
            ) : null}
            {value.end.type === "count" ? (
              <ListRow
                title="Times"
                trailing={
                  <Stepper
                    value={value.end.count}
                    label={value.end.count === 1 ? "time" : "times"}
                    onChange={(count) => update({ end: { type: "count", count } })}
                  />
                }
              />
            ) : null}
          </ListGroup>
          <GroupHint>{describeRRule(draftToRRule(value, anchor), anchor)}</GroupHint>
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

/** − 2 weeks + : a small stepper for the right side of a row. */
function Stepper({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fewer"
        onPress={() => onChange(Math.max(1, value - 1))}
        hitSlop={6}
        style={styles.step}
      >
        <Minus size={14} color={colors.foreground} />
      </Pressable>
      <Text style={styles.stepValue}>
        {value} <Text style={styles.stepUnit}>{label}</Text>
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More"
        onPress={() => onChange(Math.min(999, value + 1))}
        hitSlop={6}
        style={styles.step}
      >
        <Plus size={14} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

function DayDot({ label, accessibilityLabel, active, onPress }: { label: string; accessibilityLabel: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: active }}
      onPress={onPress}
      hitSlop={3}
      style={[styles.dot, active && styles.cellOn]}
    >
      <Text style={[styles.cellText, active && styles.cellTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Cell({ label, active, wide, onPress }: { label: string; active: boolean; wide?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.cell, wide && styles.cellWide, active && styles.cellOn]}
    >
      <Text style={[styles.cellText, active && styles.cellTextOn]}>{label}</Text>
    </Pressable>
  );
}

function MonthDayGrid({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(day: number) {
    const active = value.includes(day);
    const next = active ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.length ? next : [day]);
  }

  return (
    <View style={styles.grid}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
        <Cell key={day} label={String(day)} active={value.includes(day)} onPress={() => toggle(day)} />
      ))}
      <Cell label="Last" wide active={value.includes(LAST_DAY)} onPress={() => toggle(LAST_DAY)} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { gap: 12 },
  section: { gap: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { color: colors.foreground, fontSize: 14, fontWeight: "600", minWidth: 64, textAlign: "center" },
  stepUnit: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  gridLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginHorizontal: 14, marginTop: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12 },
  cell: { width: 36, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  cellWide: { width: 48 },
  cellOn: { backgroundColor: colors.primary },
  cellText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
  cellTextOn: { color: colors.primaryForeground, fontWeight: "600" },
}));
