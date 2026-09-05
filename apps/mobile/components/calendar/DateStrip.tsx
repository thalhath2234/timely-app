import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { addDays, dayKey, isSameDay, startOfDay } from "../../lib/format";
import { colors } from "../../lib/theme";

export default function DateStrip({
  selected,
  onSelect,
  busyDays,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  busyDays: Set<string>;
}) {
  const start = addDays(startOfDay(selected), -10);
  const days = Array.from({ length: 28 }, (_, i) => addDays(start, i));
  const today = new Date();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {days.map((d) => {
        const on = isSameDay(d, selected);
        const isToday = isSameDay(d, today);
        return (
          <Pressable key={d.toISOString()} onPress={() => onSelect(d)} style={[styles.day, on && styles.on]}>
            <Text style={[styles.wd, on && styles.onText]}>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</Text>
            <Text style={[styles.num, on && styles.onText, isToday && !on && { color: colors.primary }]}>{d.getDate()}</Text>
            {busyDays.has(dayKey(d)) ? <View style={[styles.dot, on && { backgroundColor: colors.primaryForeground }]} /> : <View style={styles.dotSpacer} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  day: { width: 44, height: 64, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2 },
  on: { backgroundColor: colors.primary },
  wd: { color: colors.mutedForeground, fontSize: 11 },
  num: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  onText: { color: colors.primaryForeground },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  dotSpacer: { width: 5, height: 5 },
});
