import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CalendarItem } from "../../lib/types";
import { addDays, dayKey, isSameDay, startOfDay } from "../../lib/format";
import { itemColor } from "./CalendarItemRow";
import { colors } from "../../lib/theme";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function MobileMonth({
  month,
  selected,
  onSelect,
  items,
  onOpen,
}: {
  month: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(startOfDay(new Date(item.start)));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }
  const today = new Date();

  return (
    <View style={{ paddingHorizontal: 8 }}>
      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.wd}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {days.map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const on = isSameDay(d, selected);
          const isToday = isSameDay(d, today);
          const dayItems = byDay.get(dayKey(d)) ?? [];
          return (
            <Pressable key={d.toISOString()} onPress={() => onSelect(d)} style={[styles.cell, on && styles.cellOn]}>
              <Text style={[styles.num, !inMonth && { opacity: 0.35 }, isToday && { color: colors.primary }]}>
                {d.getDate()}
              </Text>
              <View style={styles.dots}>
                {dayItems.slice(0, 3).map((item) => (
                  <Pressable key={item.id} onPress={() => onOpen(item)}>
                    <View style={[styles.dot, { backgroundColor: itemColor(item) }]} />
                  </Pressable>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 11, paddingVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, minHeight: 64, padding: 4, borderRadius: 10 },
  cellOn: { backgroundColor: colors.accent },
  num: { color: colors.foreground, fontSize: 13, fontWeight: "500", textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 3, marginTop: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
