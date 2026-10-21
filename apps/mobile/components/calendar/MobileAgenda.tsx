import { memo, useMemo, type ReactElement } from "react";
import { SectionList, Text, View, type RefreshControlProps } from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { dayKey, formatRelativeDay, formatTime, isSameDay, startOfDay } from "../../lib/format";
import CalendarItemRow, { isReminderItem, itemColor } from "./CalendarItemRow";
import EmptyState from "../ui/EmptyState";
import { colors, createThemedStyleSheet } from "../../lib/theme";

type RowHandlers = { onOpen: (item: CalendarItem) => void; onToggle: (item: CalendarItem) => void };

export const AgendaTimelineRow = memo(function AgendaTimelineRow({ item, onOpen, onToggle, overdue = false }: RowHandlers & { item: CalendarItem; overdue?: boolean }) {
  return <View style={styles.timelineRow}>
    <View style={styles.timeRail}>
      <Text style={styles.timeText}>{item.allDay ? "ALL" : formatTime(item.start)}</Text>
      {!item.allDay && !isReminderItem(item) ? <Text style={styles.endText}>{formatTime(item.end)}</Text> : null}
      <View style={[styles.railDot, { backgroundColor: itemColor(item) }]} />
    </View>
    <CalendarItemRow item={item} onOpen={onOpen} onToggle={onToggle} overdue={overdue} timeline />
  </View>;
});

type Section = { key: string; date: Date | null; data: CalendarItem[] };

export default function MobileAgenda({
  items,
  from,
  overdue = [],
  onOpen,
  onToggle,
  refreshControl,
  bottomInset,
}: RowHandlers & {
  items: CalendarItem[];
  from: Date;
  overdue?: CalendarItem[];
  refreshControl?: ReactElement<RefreshControlProps>;
  bottomInset: number;
}) {
  // Reminders are listed too, as in Week and Month.
  const sections = useMemo(() => {
    const today = startOfDay(new Date());
    const first = startOfDay(from);
    const overdueIds = new Set(overdue.map((item) => item.taskId ?? item.id));
    const days = new Map<string, Section>();
    for (const item of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
      const d = startOfDay(new Date(item.start));
      if (d < first) continue;
      if (d < today && overdueIds.has(item.taskId ?? item.id)) continue;
      const key = dayKey(d);
      if (!days.has(key)) days.set(key, { key, date: d, data: [] });
      days.get(key)!.data.push(item);
    }
    return [...(overdue.length > 0 ? [{ key: "overdue", date: null, data: overdue }] : []), ...days.values()];
  }, [items, from, overdue]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item, section }) => <AgendaTimelineRow item={item} onOpen={onOpen} onToggle={onToggle} overdue={section.date === null} />}
      renderSectionHeader={({ section }) => <AgendaHeader date={section.date} count={section.data.length} />}
      stickySectionHeadersEnabled={false}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={7}
      ListEmptyComponent={
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled"
          description="Events, task blocks and reminders for the coming days will show here."
        />
      }
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset }}
    />
  );
}

function AgendaHeader({ date, count }: { date: Date | null; count: number }) {
  if (!date) {
    return (
      <View style={styles.head}>
        <View style={styles.dangerDot} />
        <Text style={[styles.day, { color: colors.destructive }]}>Overdue</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.head}>
      <Text style={[styles.day, isSameDay(date, new Date()) && { color: colors.primary }]}>
        {formatRelativeDay(date, undefined)}
      </Text>
      <Text style={styles.meta}>
        {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {count}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 22, paddingBottom: 12, paddingHorizontal: 4 },
  day: { color: colors.foreground, fontSize: 18, fontWeight: "600", letterSpacing: -0.3, flexShrink: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 0 },
  dangerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.destructive },
  countPill: { minWidth: 22, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,63,94,0.12)", borderWidth: 1, borderColor: "rgba(244,63,94,0.25)" },
  countText: { color: colors.destructive, fontSize: 10, fontWeight: "600" },
  timelineRow: { flexDirection: "row", alignItems: "stretch", gap: 9, paddingBottom: 8 },
  timeRail: { width: 70, alignItems: "flex-end", justifyContent: "flex-start", paddingTop: 10, paddingRight: 10, borderRightWidth: 1, borderRightColor: colors.border },
  timeText: { color: colors.foreground, fontSize: 11, lineHeight: 14, textAlign: "right", fontVariant: ["tabular-nums"] },
  endText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 13, textAlign: "right", fontVariant: ["tabular-nums"] },
  railDot: { position: "absolute", right: -4, top: 16, width: 8, height: 8, borderRadius: 4 },
}));
