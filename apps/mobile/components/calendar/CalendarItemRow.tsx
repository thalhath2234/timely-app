import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarClock, Check, ListTodo, Repeat } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { formatTimeRange } from "../../lib/format";
import { colors } from "../../lib/theme";

export function itemColor(item: CalendarItem) {
  return item.color ?? item.task?.project?.color ?? colors.primary;
}

export function isTaskItem(item: CalendarItem) {
  return item.kind === "task" || item.kind === "taskOccurrence";
}

export default function CalendarItemRow({
  item,
  onOpen,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
}) {
  const done = Boolean(item.completedAt);
  const recurring = item.kind.endsWith("Occurrence") || Boolean(item.seriesId);
  const Icon = isTaskItem(item) ? ListTodo : CalendarClock;

  return (
    <Pressable onPress={() => onOpen(item)} style={styles.row}>
      <View style={[styles.bar, { backgroundColor: itemColor(item) }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.title, done && styles.done]}>
          {item.title}
        </Text>
        <View style={styles.meta}>
          <Icon size={12} color={colors.mutedForeground} />
          <Text style={styles.metaText}>{item.allDay ? "All day" : formatTimeRange(item.start, item.end)}</Text>
          {recurring ? <Repeat size={12} color={colors.mutedForeground} /> : null}
        </View>
      </View>
      {done ? <Check size={16} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 10,
    paddingRight: 12,
    paddingLeft: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 4 },
  title: { color: colors.cardForeground, fontSize: 15, fontWeight: "500" },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  metaText: { color: colors.mutedForeground, fontSize: 12 },
});
