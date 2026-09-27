import { useEffect, useRef, useState } from "react";
import { Dimensions, NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text, View } from "react-native";
import { addDays, dayKey, isSameDay, startOfDay } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";

export default function DateStrip({
  selected,
  onSelect,
  busyDays,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  busyDays: Set<string>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const ignoreScroll = useRef(true);
  const skipMomentum = useRef(false);
  const [pageWidth, setPageWidth] = useState(Dimensions.get("window").width);
  const today = new Date();
  const selectedWeekStart = addDays(startOfDay(selected), -selected.getDay());
  const [weekStart, setWeekStart] = useState(selectedWeekStart);
  const days = Array.from({ length: 21 }, (_, i) => addDays(weekStart, i - 7));

  useEffect(() => {
    setWeekStart((current) =>
      current.getTime() === selectedWeekStart.getTime() ? current : selectedWeekStart,
    );
  }, [selectedWeekStart.getTime()]);

  useEffect(() => {
    ignoreScroll.current = true;
    scrollRef.current?.scrollTo({ x: pageWidth, animated: false });
    const id = requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [weekStart.getTime(), pageWidth]);

  function onPage(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (ignoreScroll.current || pageWidth <= 0) return;
    const page = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    if (page === 1) return;
    setWeekStart((current) => addDays(current, (page - 1) * 7));
  }

  function onDragEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const velocity = event.nativeEvent.velocity?.x ?? 0;
    if (Math.abs(velocity) > 0.05) return;
    skipMomentum.current = true;
    onPage(event);
  }

  function onMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (skipMomentum.current) {
      skipMomentum.current = false;
      return;
    }
    onPage(event);
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.strip}
      horizontal
      pagingEnabled
      decelerationRate="fast"
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumEnd}
      onScrollEndDrag={onDragEnd}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0 && width !== pageWidth) setPageWidth(width);
      }}
    >
      {[0, 1, 2].map((week) => (
        <View key={`${weekStart.getTime()}-${week}`} style={[styles.week, { width: pageWidth }]}>
          {days.slice(week * 7, week * 7 + 7).map((d) => {
            const on = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            return (
              <AnimatedPressable key={d.toISOString()} onPress={() => onSelect(d)} style={styles.day}>
                <Text style={[styles.wd, on && styles.onText]}>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</Text>
                <View style={[styles.numWrap, on && styles.on]}>
                  <Text style={[styles.num, on && styles.numOnText, isToday && !on && { color: colors.primary }]}>
                    {d.getDate()}
                  </Text>
                </View>
                {busyDays.has(dayKey(d)) ? (
                  <View style={[styles.dot, on && { backgroundColor: colors.primary }]} />
                ) : (
                  <View style={styles.dotSpacer} />
                )}
              </AnimatedPressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  strip: { height: 82, flexGrow: 0 },
  week: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  day: { width: 44, alignItems: "center", justifyContent: "center", gap: 4 },
  numWrap: { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.primary },
  wd: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600" },
  num: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
  onText: { color: colors.primary },
  numOnText: { color: colors.primaryForeground },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedForeground },
  dotSpacer: { width: 5, height: 5 },
}));
