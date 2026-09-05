import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CalendarItem } from "../../lib/types";
import { HOURS, formatHour } from "../../lib/types";
import { isSameDay, startOfDay } from "../../lib/format";
import { itemColor } from "./CalendarItemRow";
import { colors } from "../../lib/theme";

const HOUR_PX = 56;

function layout(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const placed: { item: CalendarItem; col: number; cols: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1), 1);
    for (const c of cluster) c.cols = cols;
    placed.push(...cluster);
    cluster = [];
  };
  for (const item of sorted) {
    const s = new Date(item.start).getTime();
    const e = new Date(item.end).getTime();
    if (s >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => new Date(c.item.end).getTime() > s).map((c) => c.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ item, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return placed;
}

export default function MobileDay({
  date,
  items,
  onOpen,
}: {
  date: Date;
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
}) {
  const dayStart = startOfDay(date).getTime();
  const isToday = isSameDay(date, new Date());
  const nowY = ((Date.now() - dayStart) / 3_600_000) * HOUR_PX;
  const allDay = items.filter((i) => i.allDay);
  const timed = layout(items.filter((i) => !i.allDay));

  return (
    <ScrollView contentOffset={{ x: 0, y: isToday ? Math.max(0, nowY - 160) : 7 * HOUR_PX }}>
      {allDay.length ? (
        <View style={styles.allDay}>
          {allDay.map((item) => (
            <Pressable key={item.id} onPress={() => onOpen(item)} style={[styles.allDayItem, { backgroundColor: itemColor(item) + "33" }]}>
              <View style={[styles.dot, { backgroundColor: itemColor(item) }]} />
              <Text style={styles.allDayText}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ height: 24 * HOUR_PX, flexDirection: "row" }}>
        <View style={{ width: 52 }}>
          {HOURS.map((h) => (
            <View key={h} style={{ height: HOUR_PX }}>
              <Text style={styles.hour}>{formatHour(h)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.rail}>
          {HOURS.map((h) => (
            <View key={h} style={styles.line} />
          ))}
          {timed.map(({ item, col, cols }) => {
            const s = new Date(item.start).getTime();
            const e = new Date(item.end).getTime();
            const top = ((s - dayStart) / 3_600_000) * HOUR_PX;
            const height = Math.max(26, ((e - s) / 3_600_000) * HOUR_PX - 2);
            const width = `${100 / cols}%` as const;
            const done = Boolean(item.completedAt);
            return (
              <Pressable
                key={item.id}
                onPress={() => onOpen(item)}
                style={[
                  styles.block,
                  {
                    top,
                    height,
                    left: `${col * (100 / cols)}%`,
                    width,
                    borderLeftColor: itemColor(item),
                    backgroundColor: itemColor(item) + (done ? "1A" : "33"),
                  },
                ]}
              >
                <Text numberOfLines={1} style={[styles.blockTitle, done && styles.done]}>
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
          {isToday ? <View style={[styles.now, { top: nowY }]} /> : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  allDay: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  allDayItem: { height: 32, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  allDayText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hour: { color: colors.mutedForeground, fontSize: 11, textAlign: "right", paddingRight: 8, marginTop: -6 },
  rail: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  line: { height: HOUR_PX, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  block: { position: "absolute", paddingHorizontal: 6, paddingVertical: 4, borderLeftWidth: 3, borderRadius: 8 },
  blockTitle: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  now: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: colors.destructive },
});
