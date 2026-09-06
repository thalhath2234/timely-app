import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { addDays, dayKey, isSameDay, startOfDay } from "../../lib/format";
import CalendarItemRow, { itemColor } from "./CalendarItemRow";
import EmptyState from "../ui/EmptyState";
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
  const selectedItems = (byDay.get(dayKey(selected)) ?? []).sort((a, b) => a.start.localeCompare(b.start));

  return (
    <View style={styles.root}>
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
              <Pressable key={d.toISOString()} onPress={() => onSelect(d)} style={styles.cell}>
                <View style={[styles.numWrap, on && styles.numOn]}>
                  <Text
                    style={[
                      styles.num,
                      !inMonth && { opacity: 0.35 },
                      isToday && !on && { color: colors.primary },
                      on && styles.numOnText,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {dayItems.slice(0, 3).map((item) => (
                    <View
                      key={item.id}
                      style={[styles.dot, { backgroundColor: itemColor(item), opacity: inMonth ? 1 : 0.35 }]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView style={styles.dayList} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
        <View style={styles.dayHead}>
          <Text style={styles.dayTitle}>
            {selected.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </Text>
          <Text style={styles.dayMeta}>
            {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"}
          </Text>
        </View>
        {selectedItems.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Free day" description="Nothing scheduled on this date." />
        ) : (
          <View style={{ gap: 8 }}>
            {selectedItems.map((item) => (
              <CalendarItemRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  week: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 11, paddingVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%` as `${number}%`, minHeight: 52, alignItems: "center", paddingVertical: 4 },
  numWrap: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  numOn: { backgroundColor: colors.primary },
  num: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  numOnText: { color: colors.primaryForeground, fontWeight: "700" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 3, height: 8, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayList: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  dayTitle: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  dayMeta: { color: colors.mutedForeground, fontSize: 12 },
});
