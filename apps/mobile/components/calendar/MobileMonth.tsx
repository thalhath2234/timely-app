import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { addDays, addMonths, dayKey, isSameDay, startOfDay } from "../../lib/format";
import CalendarItemRow, { itemColor } from "./CalendarItemRow";
import EmptyState from "../ui/EmptyState";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const gridStart = addDays(first, -first.getDay());
  const count = first.getDay() + last.getDate() + (6 - last.getDay());
  return Array.from({ length: count }, (_, i) => addDays(gridStart, i));
}

function MonthGrid({
  month,
  selected,
  onSelect,
  byDay,
}: {
  month: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  byDay: Map<string, CalendarItem[]>;
}) {
  const days = monthDays(month);
  const weeks = Math.ceil(days.length / 7);
  const today = new Date();
  return (
    <View>
      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.wd}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: weeks }, (_, week) => (
        <View key={week} style={styles.week}>
          {days.slice(week * 7, week * 7 + 7).map((d) => {
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
      ))}
    </View>
  );
}

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
  const scrollRef = useRef<ScrollView>(null);
  const ignoreScroll = useRef(true);
  const [pageWidth, setPageWidth] = useState(Dimensions.get("window").width);
  const [pagerHeight, setPagerHeight] = useState(0);
  const monthKey = `${month.getFullYear()}-${month.getMonth()}`;
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(startOfDay(new Date(item.start)));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }
  const selectedItems = (byDay.get(dayKey(selected)) ?? []).sort((a, b) => a.start.localeCompare(b.start));

  useEffect(() => {
    ignoreScroll.current = true;
    scrollRef.current?.scrollTo({ x: pageWidth, animated: false });
    const id = requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [monthKey, pageWidth]);

  function onPage(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (ignoreScroll.current || pageWidth <= 0) return;
    const page = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    if (page === 1) return;
    onSelect(addMonths(selected, page - 1));
  }

  return (
    <View style={styles.root}>
      <View
        style={[styles.pagerWrap, pagerHeight > 0 ? { height: pagerHeight } : null]}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          if (width > 0 && width !== pageWidth) setPageWidth(width);
        }}
      >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
        onMomentumScrollEnd={onPage}
        onScrollEndDrag={(event) => {
          const velocity = event.nativeEvent.velocity?.x ?? 0;
          if (Math.abs(velocity) < 0.05) onPage(event);
        }}
      >
        {[-1, 0, 1].map((offset) => {
          const pageMonth = addMonths(month, offset);
          return (
            <View
              key={`${pageMonth.getFullYear()}-${pageMonth.getMonth()}`}
              style={{ width: pageWidth, paddingHorizontal: 8 }}
              onLayout={(event) => {
                if (offset !== 0) return;
                const height = Math.round(event.nativeEvent.layout.height);
                if (height > 0 && height !== pagerHeight) setPagerHeight(height);
              }}
            >
              <MonthGrid month={pageMonth} selected={selected} onSelect={onSelect} byDay={byDay} />
            </View>
          );
        })}
      </ScrollView>
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
          <EmptyState icon={CalendarDays} title="Free day" description="Nothing scheduled on this date." compact />
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

const styles = createThemedStyleSheet((colors) => ({
  root: { flex: 1 },
  pagerWrap: { overflow: "hidden" },
  pager: { flexGrow: 0, flexShrink: 0 },
  pagerContent: { flexGrow: 0, alignItems: "flex-start" },
  week: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 11, paddingVertical: 8 },
  cell: { flex: 1, minHeight: 52, alignItems: "center", paddingVertical: 4 },
  numWrap: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  numOn: { backgroundColor: "#6558E8", shadowColor: "#818CF8", shadowOpacity: 0.45, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  num: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  numOnText: { color: colors.primaryForeground, fontWeight: "700" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 3, height: 8, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayList: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 10, paddingBottom: 4, paddingHorizontal: 4 },
  dayTitle: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  dayMeta: { color: colors.mutedForeground, fontSize: 12 },
}));
