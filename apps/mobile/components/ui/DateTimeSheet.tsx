import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./primitives";
import { addDays, formatShortDate, formatTime, startOfDay } from "../../lib/format";
import { colors } from "../../lib/theme";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function DateTimeSheet({
  open,
  value,
  onClose,
  onChange,
  mode = "datetime",
}: {
  open: boolean;
  value: Date | null;
  onClose: () => void;
  onChange: (next: Date | null) => void;
  mode?: "date" | "datetime";
}) {
  const initial = value ?? new Date();
  const [day, setDay] = useState(startOfDay(initial));
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(Math.round(initial.getMinutes() / 15) * 15 % 60);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 21 }, (_, i) => addDays(today, i - 3));
  }, []);

  function apply() {
    const next = new Date(day);
    if (mode === "datetime") next.setHours(hour, minute, 0, 0);
    onChange(next);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Pick a time">
      <Text style={styles.label}>Day</Text>
      <View style={styles.wrap}>
        {days.map((d) => {
          const on = d.getTime() === day.getTime();
          return (
            <Pressable key={d.toISOString()} onPress={() => setDay(d)} style={[styles.pill, on && styles.pillOn]}>
              <Text style={[styles.pillText, on && styles.onText]}>{formatShortDate(d.toISOString())}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode === "datetime" ? (
        <>
          <Text style={styles.label}>Time</Text>
          <View style={styles.wrap}>
            {Array.from({ length: 24 }, (_, h) => (
              <Pressable key={h} onPress={() => setHour(h)} style={[styles.pill, hour === h && styles.pillOn]}>
                <Text style={[styles.pillText, hour === h && styles.onText]}>{pad(h)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.wrap}>
            {[0, 15, 30, 45].map((m) => (
              <Pressable key={m} onPress={() => setMinute(m)} style={[styles.pill, minute === m && styles.pillOn]}>
                <Text style={[styles.pillText, minute === m && styles.onText]}>{pad(m)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <View style={{ height: 12 }} />
      <PrimaryButton
        label={`Set ${formatTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString())}`}
        onPress={apply}
      />
      <Pressable onPress={() => { onChange(null); onClose(); }} style={styles.clear}>
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", marginBottom: 8, marginTop: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.primary },
  pillText: { color: colors.mutedForeground, fontSize: 13 },
  onText: { color: colors.accentForeground },
  clear: { alignItems: "center", paddingVertical: 12 },
  clearText: { color: colors.mutedForeground },
});
