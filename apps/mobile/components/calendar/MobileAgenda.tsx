import { Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { dayKey, formatRelativeDay, formatTime, isSameDay, startOfDay } from "../../lib/format";
import CalendarItemRow, { isReminderItem, itemColor } from "./CalendarItemRow";
import EmptyState from "../ui/EmptyState";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export function AgendaTimelineRow({ item, onOpen, overdue = false }: { item: CalendarItem; onOpen: (item: CalendarItem) => void; overdue?: boolean }) {
  return <View style={styles.timelineRow}>
    <View style={styles.timeRail}>
      <Text style={styles.timeText}>{item.allDay ? "ALL" : formatTime(item.start)}</Text>
      {!item.allDay && !isReminderItem(item) ? <Text style={styles.endText}>{formatTime(item.end)}</Text> : null}
      <View style={[styles.railDot, { backgroundColor: itemColor(item) }]} />
    </View>
    <CalendarItemRow item={item} onOpen={onOpen} overdue={overdue} timeline />
  </View>;
}

export default function MobileAgenda({
  items,
  from,
  overdue = [],
  onOpen,
}: {
  items: CalendarItem[];
  from: Date;
  overdue?: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
}) {
  const today = startOfDay(new Date());
  const sorted = [...items]
    .filter((item) => !isReminderItem(item))
    .sort((a, b) => a.start.localeCompare(b.start));
  const overdueIds = new Set(overdue.map((item) => item.taskId ?? item.id));
  const groups = new Map<string, { date: Date; items: CalendarItem[] }>();
  for (const item of sorted) {
    const d = startOfDay(new Date(item.start));
    if (d < startOfDay(from)) continue;
    if (d < today && overdueIds.has(item.taskId ?? item.id)) continue;
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key)!.items.push(item);
  }

  if (groups.size === 0 && overdue.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Events and scheduled task blocks for the coming days will show here."
      />
    );
  }

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {overdue.length > 0 ? (
        <View>
          <View style={styles.head}>
            <View style={styles.dangerDot} />
            <Text style={[styles.day, { color: colors.destructive }]}>Overdue</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{overdue.length}</Text>
            </View>
          </View>
          <View>
            {overdue.map((item) => (
              <AgendaTimelineRow key={item.id} item={item} onOpen={onOpen} overdue />
            ))}
          </View>
        </View>
      ) : null}
      {[...groups.values()].map((group) => (
        <View key={group.date.toISOString()}>
          <View style={styles.head}>
            <Text style={[styles.day, isSameDay(group.date, today) && { color: colors.primary }]}>
              {formatRelativeDay(group.date)}
            </Text>
            <Text style={styles.meta}>
              {group.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {group.items.length}
            </Text>
          </View>
          <View>
            {group.items.map((item) => (
              <AgendaTimelineRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 22, paddingBottom: 12, paddingHorizontal: 4 },
  day: { color: colors.foreground, fontSize: 18, fontWeight: "800", letterSpacing: -0.3, flexShrink: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 0 },
  dangerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.destructive },
  countPill: { minWidth: 22, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,63,94,0.12)", borderWidth: 1, borderColor: "rgba(244,63,94,0.25)" },
  countText: { color: colors.destructive, fontSize: 10, fontWeight: "700" },
  timelineRow: { flexDirection: "row", alignItems: "stretch", gap: 9, paddingBottom: 8 },
  timeRail: { width: 70, alignItems: "flex-end", justifyContent: "flex-start", paddingTop: 10, paddingRight: 10, borderRightWidth: 1, borderRightColor: colors.border },
  timeText: { color: colors.foreground, fontSize: 10, fontFamily: "SpaceMono", lineHeight: 14, textAlign: "right" },
  endText: { color: colors.mutedForeground, fontSize: 9, fontFamily: "SpaceMono", lineHeight: 13, textAlign: "right" },
  railDot: { position: "absolute", right: -4, top: 16, width: 8, height: 8, borderRadius: 4 },
}));
