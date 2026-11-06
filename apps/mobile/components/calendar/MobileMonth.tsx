import { memo, useCallback, useMemo, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { addDays, addMonths, dayKey, isSameDay, startOfDay } from "../../lib/format";
import { itemColor } from "./CalendarItemRow";
import { AgendaTimelineRow } from "./MobileAgenda";
import PeriodPager from "./PeriodPager";
import EmptyState from "../ui/EmptyState";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/** Months either side of the first one shown that a swipe can reach. */
const SPAN = 240;

/** Always six weeks, so every month is as tall as the next and the day list never jumps. */
function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function monthsBetween(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
}

const MonthGrid = memo(function MonthGrid({
  monthStart,
  selected,
  onSelect,
  byDay,
}: {
  /** The 1st of the month as a timestamp: a number keeps the memo when the page re-renders. */
  monthStart: number;
  /** The selected day when it falls in this grid, so the other months skip the re-render. */
  selected: Date | null;
  onSelect: (d: Date) => void;
  byDay: Map<string, CalendarItem[]>;
}) {
  const month = new Date(monthStart);
  const days = monthDays(month);
  const today = new Date();
  return (
    <View>
      {Array.from({ length: 6 }, (_, week) => (
        <View key={week} style={styles.week}>
          {days.slice(week * 7, week * 7 + 7).map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const on = selected !== null && isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            const dayItems = byDay.get(dayKey(d)) ?? [];
            return (
              <AnimatedPressable key={d.toISOString()} onPress={() => onSelect(d)} style={styles.cell}>
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
              </AnimatedPressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

export default function MobileMonth({
  selected,
  onSelect,
  items,
  onOpen,
  onToggle,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
  onToggle: (item: CalendarItem) => void;
}) {
  const [pageWidth, setPageWidth] = useState(Dimensions.get("window").width);
  const [anchor, setAnchor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  let index = monthsBetween(anchor, selected) + SPAN;
  if (index < 0 || index > SPAN * 2) {
    setAnchor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    index = SPAN;
  }
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = dayKey(startOfDay(new Date(item.start)));
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);
  const selectedItems = useMemo(
    () => [...(byDay.get(dayKey(selected)) ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
    [byDay, selected],
  );

  const renderPage = useCallback(
    (page: number) => {
      const month = addMonths(anchor, page - SPAN);
      const inMonth = selected.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth();
      return (
        <View style={{ width: pageWidth, paddingHorizontal: 8 }}>
          <MonthGrid monthStart={month.getTime()} selected={inMonth ? selected : null} onSelect={onSelect} byDay={byDay} />
        </View>
      );
    },
    [anchor, selected, onSelect, byDay, pageWidth],
  );

  return (
    <View style={styles.root}>
      <View
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          if (width > 0 && width !== pageWidth) setPageWidth(width);
        }}
      >
        <View style={[styles.week, { paddingHorizontal: 8 }]}>
          {WEEKDAYS.map((d, i) => (
            <Text key={`${d}-${i}`} style={styles.wd}>
              {d}
            </Text>
          ))}
        </View>
        <PeriodPager
          key={anchor.getTime()}
          index={index}
          count={SPAN * 2 + 1}
          width={pageWidth}
          extraData={renderPage}
          renderPage={renderPage}
          onIndexChange={(page) => onSelect(addMonths(selected, page - index))}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.dayList} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
        <View style={styles.dayHead}>
          <Text style={styles.dayTitle}>
            {selected.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </Text>
          <Text style={styles.dayMeta}>
            {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"}
          </Text>
        </View>
        {selectedItems.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Free day" description="Nothing scheduled on this date." compact />
        ) : (
          <View>
            {selectedItems.map((item) => (
              <AgendaTimelineRow key={item.id} item={item} onOpen={onOpen} onToggle={onToggle} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { flex: 1 },
  week: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 11, paddingVertical: 8 },
  cell: { flex: 1, minHeight: 52, alignItems: "center", paddingVertical: 4 },
  numWrap: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  numOn: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.45, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  num: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  numOnText: { color: colors.primaryForeground, fontWeight: "600" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 3, height: 8, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayList: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 10, paddingBottom: 4, paddingHorizontal: 4 },
  dayTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontWeight: "600" },
  dayMeta: { color: colors.mutedForeground, fontSize: 12, flexShrink: 0 },
}));
