import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CalendarItem } from "../../lib/types";
import { addDays, dayKey, isSameDay, startOfDay, startOfWeek } from "../../lib/format";
import { AgendaTimelineRow } from "./MobileAgenda";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { floatingTabBarInset } from "../ui/FloatingTabBar";

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
  const insets = useSafeAreaInsets();
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
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: floatingTabBarInset(insets.bottom) }]}>
      {days.map((day) => {
        const key = dayKey(day);
        const dayItems = (byDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
        const on = isSameDay(day, selected);
        const today = isSameDay(day, new Date());
        return (
          <AnimatedPressable
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
              dayItems.slice(0, 6).map((item) => <AgendaTimelineRow key={item.id} item={item} onOpen={onOpen} />)
            )}
            {dayItems.length > 6 ? <Text style={styles.more}>+{dayItems.length - 6} more</Text> : null}
          </AnimatedPressable>
        );
      })}
    </ScrollView>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 12, gap: 10, paddingBottom: 40 },
  day: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.background,
    padding: 12,
    gap: 8,
  },
  dayOn: { borderLeftColor: colors.primary, backgroundColor: colors.accent },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  wd: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  num: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  empty: { color: colors.mutedForeground, fontSize: 11, textAlign: "center", paddingVertical: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 9 },
  more: { color: colors.mutedForeground, fontSize: 12 },
}));
