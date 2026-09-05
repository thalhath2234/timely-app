import { StyleSheet, Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { dayKey, formatRelativeDay, isSameDay, startOfDay } from "../../lib/format";
import CalendarItemRow from "./CalendarItemRow";
import EmptyState from "../ui/EmptyState";
import { colors } from "../../lib/theme";

export default function MobileAgenda({
  items,
  from,
  onOpen,
}: {
  items: CalendarItem[];
  from: Date;
  onOpen: (item: CalendarItem) => void;
}) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const groups = new Map<string, { date: Date; items: CalendarItem[] }>();
  for (const item of sorted) {
    const d = startOfDay(new Date(item.start));
    if (d < startOfDay(from)) continue;
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key)!.items.push(item);
  }

  if (groups.size === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Events and scheduled task blocks for the coming days will show here."
      />
    );
  }

  const today = new Date();
  return (
    <View style={{ paddingHorizontal: 12 }}>
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
          <View style={{ gap: 8 }}>
            {group.items.map((item) => (
              <CalendarItemRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  day: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12 },
});
