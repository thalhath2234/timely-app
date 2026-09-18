import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import { formatMonthYear, isSameDay, startOfDay } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthCells(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  const padDays = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < padDays; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function snapMinute(raw: number) {
  return (Math.round(raw / 15) * 15) % 60;
}

function hour12(hours24: number) {
  const value = hours24 % 12;
  return value === 0 ? 12 : value;
}

function toHour24(h12: number, pm: boolean) {
  if (h12 === 12) return pm ? 12 : 0;
  return pm ? h12 + 12 : h12;
}

function WheelColumn({
  label,
  value,
  onUp,
  onDown,
}: {
  label: string;
  value: string;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <View style={styles.wheel}>
      <Text style={styles.wheelLabel}>{label}</Text>
      <Pressable accessibilityLabel={`Increase ${label}`} onPress={onUp} style={styles.wheelBtn}>
        <ChevronUp size={16} color={colors.mutedForeground} />
      </Pressable>
      <Text style={styles.wheelValue}>{value}</Text>
      <Pressable accessibilityLabel={`Decrease ${label}`} onPress={onDown} style={styles.wheelBtn}>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

export default function DateTimeSheet({
  open,
  value,
  onClose,
  onChange,
  mode = "datetime",
  title,
  clearable = true,
}: {
  open: boolean;
  value: Date | null;
  onClose: () => void;
  onChange: (next: Date | null) => void;
  mode?: "date" | "datetime" | "time";
  title?: string;
  clearable?: boolean;
}) {
  const initial = value ?? new Date();
  const [month, setMonth] = useState(() => startOfMonth(initial));
  const [day, setDay] = useState(() => startOfDay(initial));
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(snapMinute(initial.getMinutes()));
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      const next = value ?? new Date();
      setMonth(startOfMonth(next));
      setDay(startOfDay(next));
      setHour(next.getHours());
      setMinute(snapMinute(next.getMinutes()));
    }
    wasOpen.current = open;
  }, [open, value]);

  const cells = useMemo(() => monthCells(month), [month]);
  const today = useMemo(() => new Date(), []);
  const preview = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);

  function commitDay(next: Date) {
    setDay(startOfDay(next));
    if (mode === "date") {
      const stamped = new Date(next);
      stamped.setHours(0, 0, 0, 0);
      onChange(stamped);
      onClose();
    }
  }

  function commitTime(nextHours: number, nextMinutes: number) {
    setHour(nextHours);
    setMinute(nextMinutes);
    if (mode === "time") {
      const next = new Date(value ?? new Date());
      next.setHours(nextHours, nextMinutes, 0, 0);
      onChange(next);
    }
  }

  function apply() {
    if (mode === "time") {
      const next = new Date(value ?? new Date());
      next.setHours(hour, minute, 0, 0);
      onChange(next);
    } else if (mode === "date") {
      const stamped = new Date(day);
      stamped.setHours(0, 0, 0, 0);
      onChange(stamped);
    } else {
      onChange(preview);
    }
    onClose();
  }

  function setNow() {
    const now = new Date();
    const snapped = snapMinute(now.getMinutes());
    setMonth(startOfMonth(now));
    setDay(startOfDay(now));
    setHour(now.getHours());
    setMinute(snapped);
    if (mode === "date") {
      now.setHours(0, 0, 0, 0);
      onChange(now);
      onClose();
      return;
    }
    if (mode === "time") {
      const next = new Date(value ?? now);
      next.setHours(now.getHours(), snapped, 0, 0);
      onChange(next);
      return;
    }
    onChange(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), snapped));
  }

  const heading =
    title ?? (mode === "time" ? "Pick a time" : mode === "date" ? "Pick a date" : "Pick date & time");

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={heading}
      footer={
        <View style={styles.footerActions}>
          <Pressable onPress={setNow} style={styles.footerGhost}>
            <Text style={styles.ghostText}>{mode === "time" ? "Now" : "Today"}</Text>
          </Pressable>
          {mode !== "date" ? (
            <Pressable onPress={apply} style={styles.done}>
              <Text style={styles.doneText}>✓  Done</Text>
            </Pressable>
          ) : <View style={{ flex: 1 }} />}
          {clearable ? (
            <Pressable
              onPress={() => {
                onChange(null);
                onClose();
              }}
              style={styles.footerGhost}
            >
              <Text style={styles.ghostText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {mode === "datetime" ? (
        <View style={styles.quickRow}>
          <Text style={styles.timezone}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</Text>
          <Pressable onPress={setNow} style={styles.quick}><Text style={styles.quickText}>Today</Text></Pressable>
          <Pressable
            onPress={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              setMonth(startOfMonth(tomorrow));
              setDay(startOfDay(tomorrow));
            }}
            style={styles.quick}
          >
            <Text style={styles.quickText}>Tomorrow</Text>
          </Pressable>
        </View>
      ) : null}
      {mode !== "time" ? (
        <>
          <View style={styles.monthRow}>
            <Pressable
              accessibilityLabel="Previous month"
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              style={styles.nav}
            >
              <ChevronLeft size={18} color={colors.foreground} />
            </Pressable>
            <Text style={styles.month}>{formatMonthYear(month)}</Text>
            <Pressable
              accessibilityLabel="Next month"
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              style={styles.nav}
            >
              <ChevronRight size={18} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={styles.weekdays}>
            {WEEKDAYS.map((label) => (
              <Text key={label} style={styles.weekday}>
                {label}
              </Text>
            ))}
          </View>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, week) => (
            <View key={week} style={styles.weekdays}>
              {cells.slice(week * 7, week * 7 + 7).map((cell, index) => {
                if (!cell) return <View key={`empty-${week}-${index}`} style={styles.cell} />;
                const on = isSameDay(cell, day);
                const isToday = isSameDay(cell, today);
                return (
                  <Pressable key={cell.toISOString()} onPress={() => commitDay(cell)} style={styles.cell}>
                    <View style={[styles.day, on && styles.dayOn, isToday && !on && styles.dayToday]}>
                      <Text style={[styles.dayText, on && styles.dayOnText, isToday && !on && { color: colors.primary }]}>
                        {cell.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </>
      ) : null}

      {mode === "datetime" || mode === "time" ? (
        <View style={[styles.wheels, mode === "datetime" && styles.wheelsBorder]}>
          <WheelColumn
            label="Hour"
            value={pad(hour12(hour))}
            onUp={() => commitTime((hour + 1) % 24, minute)}
            onDown={() => commitTime((hour + 23) % 24, minute)}
          />
          <WheelColumn
            label="Min"
            value={pad(minute)}
            onUp={() => commitTime(hour, (minute + 15) % 60)}
            onDown={() => commitTime(hour, (minute + 45) % 60)}
          />
          <WheelColumn
            label="Period"
            value={hour >= 12 ? "PM" : "AM"}
            onUp={() => commitTime(toHour24(hour12(hour), hour < 12), minute)}
            onDown={() => commitTime(toHour24(hour12(hour), hour < 12), minute)}
          />
        </View>
      ) : null}

    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  quickRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  timezone: { flex: 1, color: colors.mutedForeground, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7 },
  quick: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.muted },
  quickText: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  nav: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  month: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  weekdays: { flexDirection: "row", marginBottom: 4 },
  weekday: { flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 11, fontWeight: "600" },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { backgroundColor: "#6558E8", shadowColor: "#818CF8", shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  dayToday: { backgroundColor: colors.accent },
  dayText: { color: colors.foreground, fontSize: 14 },
  dayOnText: { color: colors.primaryForeground, fontWeight: "700" },
  wheels: { flexDirection: "row", gap: 8 },
  wheelsBorder: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  wheel: {
    flex: 1,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 4,
  },
  wheelLabel: {
    color: colors.mutedForeground,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  wheelBtn: { height: 28, width: "100%", alignItems: "center", justifyContent: "center" },
  wheelValue: { color: colors.foreground, fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  footerActions: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  footerGhost: { minWidth: 48, paddingHorizontal: 8, paddingVertical: 12, alignItems: "center" },
  ghostText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  done: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#6558E8", shadowColor: "#6366F1", shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  doneText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
}));
