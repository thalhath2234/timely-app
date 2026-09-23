import { StyleSheet, Text, View } from "react-native";
import { CalendarClock, Check, ListTodo, Repeat } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { formatRelativeDay, formatTime, formatTimeRange } from "../../lib/format";
import { colors, createThemedStyleSheet, radius } from "../../lib/theme";
import { taskEntityColor } from "../../lib/entityColor";
import AnimatedPressable from "../ui/AnimatedPressable";

export function itemColor(item: CalendarItem) {
  if (item.task) return taskEntityColor(item.task);
  return item.color ?? colors.primary;
}

export function isTaskItem(item: CalendarItem) {
  return item.kind === "task" || item.kind === "taskOccurrence";
}

export function isReminderItem(item: CalendarItem) {
  return Boolean(
    item.reminder ||
      item.id.endsWith("@reminder") ||
      (isTaskItem(item) && (item.task?.duration ?? 1) <= 0),
  );
}

export function calendarItemWorkspaceId(item: CalendarItem) {
  return item.task?.workspace?.id || item.task?.workspaceId || item.event?.workspaceId || null;
}

export function calendarItemProjectId(item: CalendarItem) {
  return item.task?.project?.id || item.task?.projectId || item.event?.projectId || null;
}

export function matchesCalendarScope(
  item: CalendarItem,
  workspaceId: string | null,
  projectId: string | null,
) {
  if (workspaceId && calendarItemWorkspaceId(item) !== workspaceId) return false;
  if (projectId && calendarItemProjectId(item) !== projectId) return false;
  return true;
}

export default function CalendarItemRow({
  item,
  onOpen,
  overdue,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  overdue?: boolean;
}) {
  const done = Boolean(item.completedAt);
  const recurring = item.kind.endsWith("Occurrence") || Boolean(item.seriesId);
  const Icon = isTaskItem(item) ? ListTodo : CalendarClock;
  const when = item.allDay
    ? overdue
      ? `Due ${formatRelativeDay(new Date(item.start))}`
      : "All day"
    : isReminderItem(item)
      ? `${formatTime(item.start)} · Reminder`
      : `${formatTimeRange(item.start, item.end)}${overdue ? ` · ${formatRelativeDay(new Date(item.start))}` : ""}`;

  return (
    <AnimatedPressable onPress={() => onOpen(item)} style={styles.row}>
      <View style={[styles.bar, { backgroundColor: itemColor(item) }]} />
      {isTaskItem(item) ? <View style={[styles.check, overdue && styles.checkOverdue, done && styles.checkDone]}>{done ? <Check size={12} color="#fff" /> : null}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.title, done && styles.done]}>
          {item.title}
        </Text>
        <View style={styles.meta}>
          <Icon size={12} color={overdue ? colors.destructive : colors.mutedForeground} />
          <Text style={[styles.metaText, overdue && { color: colors.destructive }]}>{when}</Text>
          {recurring ? <Repeat size={12} color={colors.mutedForeground} /> : null}
        </View>
      </View>
      {done ? <Check size={16} color={colors.primary} /> : null}
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  row: {
    minHeight: 64,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 11,
    paddingRight: 13,
    paddingLeft: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  check: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: colors.mutedForeground },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success, alignItems: "center", justifyContent: "center" },
  checkOverdue: { borderColor: "rgba(244,63,94,0.65)" },
  title: { color: colors.cardForeground, fontSize: 14, fontWeight: "600" },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  metaText: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
}));
