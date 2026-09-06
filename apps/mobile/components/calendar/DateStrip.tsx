import { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const scrollRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(Dimensions.get("window").width);
  const today = new Date();
  const weekStart = addDays(startOfDay(selected), -selected.getDay());
  const days = Array.from({ length: 21 }, (_, i) => addDays(weekStart, i - 7));

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: pageWidth, animated: false });
  }, [weekStart.getTime(), pageWidth]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0 && width !== pageWidth) setPageWidth(width);
      }}
    >
      {[0, 1, 2].map((week) => (
        <View key={week} style={[styles.week, { width: pageWidth }]}>
          {days.slice(week * 7, week * 7 + 7).map((d) => {
            const on = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            return (
              <Pressable key={d.toISOString()} onPress={() => onSelect(d)} style={styles.day}>
                <Text style={[styles.wd, on && styles.onText]}>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</Text>
                <View style={[styles.numWrap, on && styles.on]}>
                  <Text style={[styles.num, on && styles.onText, isToday && !on && { color: colors.primary }]}>
                    {d.getDate()}
                  </Text>
                </View>
                {busyDays.has(dayKey(d)) ? (
                  <View style={[styles.dot, on && { backgroundColor: colors.primary }]} />
                ) : (
                  <View style={styles.dotSpacer} />
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  week: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  day: { width: 44, alignItems: "center", justifyContent: "center", gap: 2 },
  numWrap: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.primary },
  wd: { color: colors.mutedForeground, fontSize: 11, fontWeight: "500" },
  num: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  onText: { color: colors.primaryForeground },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedForeground },
  dotSpacer: { width: 5, height: 5 },
});
