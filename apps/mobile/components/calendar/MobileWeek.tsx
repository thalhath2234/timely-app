import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CalendarItem } from "../../lib/types";
import { addDays, dayKey, formatTime, isSameDay, startOfDay, startOfWeek } from "../../lib/format";
import { itemColor } from "./CalendarItemRow";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function MobileWeek({
  selected,
  items,
  onSelect,
  onOpen,
  onEmptyDay,
}: {
  selected: Date;
  items: CalendarItem[];
  onSelect: (date: Date) => void;
  onOpen: (item: CalendarItem) => void;
  onEmptyDay?: (date: Date) => void;
}) {
  const weekStart = startOfWeek(selected);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(startOfDay(new Date(item.start)));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {days.map((day) => {
        const key = dayKey(day);
        const dayItems = (byDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
        const on = isSameDay(day, selected);
        const today = isSameDay(day, new Date());
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(day)}
            onLongPress={() => onEmptyDay?.(day)}
            style={[styles.day, on && styles.dayOn]}
          >
            <View style={styles.head}>
              <Text style={[styles.wd, today && { color: colors.primary }]}>
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </Text>
              <Text style={[styles.num, today && { color: colors.primary }]}>{day.getDate()}</Text>
            </View>
            {dayItems.length === 0 ? (
              <Text style={styles.empty}>Tap and hold to add</Text>
            ) : (
              dayItems.slice(0, 6).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onOpen(item)}
                  style={[styles.chip, { borderLeftColor: itemColor(item) }]}
                >
                  <Text numberOfLines={1} style={styles.chipText}>
                    {item.allDay ? item.title : `${formatTime(item.start)} ${item.title}`}
                  </Text>
                </Pressable>
              ))
            )}
            {dayItems.length > 6 ? <Text style={styles.more}>+{dayItems.length - 6} more</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 12, gap: 8, paddingBottom: 32 },
  day: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 10,
    gap: 6,
  },
  dayOn: { borderColor: colors.primary },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  wd: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  num: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  empty: { color: colors.mutedForeground, fontSize: 12 },
  chip: {
    borderLeftWidth: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  chipText: { color: colors.foreground, fontSize: 13 },
  more: { color: colors.mutedForeground, fontSize: 12 },
}));
