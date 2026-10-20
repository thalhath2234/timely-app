import { memo, useCallback, useState } from "react";
import { Dimensions, Text, View } from "react-native";
import { addDays, dayKey, isSameDay, startOfWeek } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import PeriodPager from "./PeriodPager";

/** Weeks either side of the first one shown that a swipe can reach. */
const SPAN = 520;
const WEEK_MS = 7 * 86_400_000;

function weeksBetween(from: Date, to: Date) {
  return Math.round((startOfWeek(to).getTime() - from.getTime()) / WEEK_MS);
}

const WeekRow = memo(function WeekRow({
  weekStart,
  selected,
  onSelect,
  busyDays,
  width,
}: {
  weekStart: number;
  /** The selected day when it falls in this week, so the other weeks skip the re-render. */
  selected: Date | null;
  onSelect: (d: Date) => void;
  busyDays: Set<string>;
  width: number;
}) {
  const today = new Date();
  return (
    <View style={[styles.week, { width }]}>
      {Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart), i)).map((d) => {
        const on = selected !== null && isSameDay(d, selected);
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
  );
});

export default function DateStrip({
  selected,
  onSelect,
  busyDays,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  busyDays: Set<string>;
}) {
  const [pageWidth, setPageWidth] = useState(Dimensions.get("window").width);
  const [anchor, setAnchor] = useState(() => startOfWeek(selected));
  let selectedIndex = weeksBetween(anchor, selected) + SPAN;
  if (selectedIndex < 0 || selectedIndex > SPAN * 2) {
    setAnchor(startOfWeek(selected));
    selectedIndex = SPAN;
  }
  // A swipe only browses: the strip shows that week until a day in another
  // week is picked, which brings it back to the selected day's week.
  const [browse, setBrowse] = useState<{ from: number; index: number } | null>(null);
  const index = browse?.from === selectedIndex ? browse.index : selectedIndex;

  const renderPage = useCallback(
    (page: number) => {
      const weekStart = addDays(anchor, (page - SPAN) * 7);
      const inWeek = page === selectedIndex;
      return <WeekRow weekStart={weekStart.getTime()} selected={inWeek ? selected : null} onSelect={onSelect} busyDays={busyDays} width={pageWidth} />;
    },
    [anchor, selected, selectedIndex, onSelect, busyDays, pageWidth],
  );

  return (
    <View
      style={styles.strip}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0 && width !== pageWidth) setPageWidth(width);
      }}
    >
      <PeriodPager
        key={anchor.getTime()}
        index={index}
        count={SPAN * 2 + 1}
        width={pageWidth}
        extraData={renderPage}
        renderPage={renderPage}
        onIndexChange={(page) => setBrowse({ from: selectedIndex, index: page })}
      />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  strip: { height: 66 },
  week: {
    height: 66,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  day: { width: 44, alignItems: "center", justifyContent: "center", gap: 2 },
  numWrap: { width: 34, height: 34, borderRadius: 17, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.primary },
  wd: { color: colors.mutedForeground, fontSize: 10, fontWeight: "600" },
  num: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  onText: { color: colors.primary },
  numOnText: { color: colors.primaryForeground },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedForeground },
  dotSpacer: { width: 5, height: 5 },
}));
