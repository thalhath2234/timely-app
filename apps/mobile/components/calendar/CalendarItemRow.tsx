import { memo } from "react";
import { Text, View } from "react-native";
import { CalendarClock, ListTodo, Repeat } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { calendarItemDone } from "@timely/contract/calendar";
import { formatRelativeDay, formatTime, formatTimeRange } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { taskEntityColor } from "../../lib/entityColor";
import AnimatedPressable from "../ui/AnimatedPressable";
import { TaskCheck } from "../ui/motionKit";

export function itemColor(item: CalendarItem) {
  if (item.task) return taskEntityColor(item.task);
  return item.color ?? colors.primary;
}

export function isTaskItem(item: CalendarItem) {
  return item.kind === "task" || item.kind === "taskOccurrence";
}

export const isItemDone = calendarItemDone;

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

export default memo(function CalendarItemRow({
  item,
  onOpen,
  onToggle,
  overdue,
  timeline,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  /** Ticks a task on or off from its circle; the rest of the row opens it. */
  onToggle: (item: CalendarItem) => void;
  overdue?: boolean;
  timeline?: boolean;
}) {
  const done = isItemDone(item);
  const recurring = item.kind.endsWith("Occurrence") || Boolean(item.seriesId);
  const Icon = isTaskItem(item) ? ListTodo : CalendarClock;
  const when = timeline
    ? done ? "Done" : item.allDay ? "All day event" : overdue ? "Overdue" : isReminderItem(item) ? "Reminder" : "Scheduled"
    : item.allDay
    ? overdue
      ? `Due ${formatRelativeDay(new Date(item.start), undefined)}`
      : "All day"
    : isReminderItem(item)
      ? `${formatTime(item.start)} · Reminder`
      : `${formatTimeRange(item.start, item.end)}${overdue ? ` · ${formatRelativeDay(new Date(item.start), undefined)}` : ""}${item.kind === "task" && item.chunkCount > 1 ? ` · Part ${item.chunkIndex + 1} of ${item.chunkCount}` : ""}`;

  return (
    <AnimatedPressable onPress={() => onOpen(item)} style={[styles.row, timeline && styles.timelineRow]}>
      <View style={[styles.bar, { backgroundColor: itemColor(item) }]} />
      {isTaskItem(item) ? (
        <TaskCheck
          checked={done}
          onToggle={() => onToggle(item)}
          label={`${done ? "Reopen" : "Complete"} ${item.title}`}
          size={19}
          borderColor={overdue ? "rgba(244,63,94,0.65)" : undefined}
          style={styles.check}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[styles.title, done && styles.done]}>
          {item.title}
        </Text>
        <View style={styles.meta}>
          <Icon size={12} color={overdue ? colors.destructive : colors.mutedForeground} />
          <Text style={[styles.metaText, overdue && { color: colors.destructive }]}>{when}</Text>
          {recurring ? <Repeat size={12} color={colors.mutedForeground} /> : null}
        </View>
      </View>
    </AnimatedPressable>
  );
});

const styles = createThemedStyleSheet((colors) => ({
  row: {
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: colors.card,
    paddingVertical: 14,
    paddingRight: 15,
    paddingLeft: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timelineRow: { flex: 1, minWidth: 0, minHeight: 62, borderWidth: 1, borderColor: colors.border },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  // Padding the press target out to ~50dp without moving the circle.
  check: { padding: 6, margin: -6 },
  title: { color: colors.cardForeground, fontSize: 15, fontWeight: "600" },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  metaText: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
}));
