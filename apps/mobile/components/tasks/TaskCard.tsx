import { memo, type ReactNode } from "react";
import { StrikeTitle, TaskCheck } from "../ui/motionKit";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays } from "lucide-react-native";
import type { Task } from "../../lib/types";
import { formatDateAndTime, formatDueDate, formatDuration, formatRelativeStamp, PRIORITY_META } from "../../lib/format";
import { isOverdue } from "@timely/contract/workStatus";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Dot } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { taskEntityColor } from "../../lib/entityColor";

function TaskCard({
  task,
  today,
  onToggle,
  selected,
  selecting,
  onSelect,
  trailing,
  hideStatus,
}: {
  task: Task;
  /** Today's date in the Working hours zone (`todayInZone`), computed once by the list. */
  today: string;
  onToggle: (task: Task) => void;
  selected?: boolean;
  selecting?: boolean;
  onSelect?: (task: Task) => void;
  /** Its own column at the card's right edge (the board's drag grip), so it never covers the meta row. */
  trailing?: ReactNode;
  /** On a board grouped by status the column already names it. */
  hideStatus?: boolean;
}) {
  const router = useRouter();
  const done = Boolean(task.completedAt);
  const overdue = isOverdue(task, today);
  const due = formatDueDate(task.deadline, today);
  const scheduled = task.scheduledOn || task.blocks?.[0]?.start;
  const scheduledLabel = scheduled
    ? /^\d{4}-\d{2}-\d{2}$/.test(scheduled)
      ? formatRelativeStamp(scheduled, today)
      : formatDateAndTime(scheduled)
    : null;
  const timeLabel = overdue ? due : scheduledLabel ?? due;
  const durationLabel = !done && task.duration > 0 ? formatDuration(task.duration) : null;
  const priority = task.priorityLevel ? PRIORITY_META[task.priorityLevel] : null;
  // The stripe is the project's colour, as on the desktop board and phone
  // Today; priority has its own pill and overdue its red date.
  const accent = taskEntityColor(task);

  return (
    <View style={[styles.card, selected && styles.selected]}>
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <TaskCheck checked={done} onToggle={() => onToggle(task)} label={`${done ? "Reopen" : "Complete"} ${task.name}`} style={styles.check} />
      <AnimatedPressable
        onPress={() => (selecting && onSelect ? onSelect(task) : router.push(`/(app)/tasks/${task.id}`))}
        onLongPress={() => onSelect?.(task)}
        style={[styles.body, trailing ? styles.bodyWithTrailing : null]}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <StrikeTitle done={done} style={styles.name}>
              {task.name}
            </StrikeTitle>
          </View>
          {durationLabel ? <Text style={styles.duration}>{durationLabel}</Text> : null}
        </View>
        <View style={styles.meta}>
          {priority && !done ? (
            <View style={[styles.priorityPill, { borderColor: `${priority.color}66`, backgroundColor: `${priority.color}22` }]}>
              <Text style={[styles.priorityText, { color: priority.color }]}>{priority.label}</Text>
            </View>
          ) : null}
          {task.status && !hideStatus ? (
            <View style={styles.metaItem}>
              <Dot color={task.status.color} />
              <Text style={styles.metaText}>{task.status.name}</Text>
            </View>
          ) : null}
          {timeLabel ? (
            <View style={styles.metaItem}>
              <CalendarDays size={11} color={overdue ? colors.destructive : colors.mutedForeground} />
              <Text style={[styles.metaText, overdue && { color: colors.destructive, fontWeight: "600" }]}>{timeLabel}</Text>
            </View>
          ) : null}
          {(task.labels ?? []).slice(0, 4).map((l) => (
            <Dot key={l.id} color={l.color} />
          ))}
        </View>
      </AnimatedPressable>
      {trailing}
    </View>
  );
}

export default memo(TaskCard);

const styles = createThemedStyleSheet((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { backgroundColor: colors.accent },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2, marginVertical: 12, marginLeft: 10 },
  check: { width: 52, alignItems: "center", justifyContent: "center" },
  box: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.success, borderColor: colors.success },
  body: { flex: 1, minHeight: 76, justifyContent: "center", paddingVertical: 14, paddingRight: 14, gap: 7 },
  bodyWithTrailing: { paddingRight: 2 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  name: { flex: 1, minWidth: 0, color: colors.cardForeground, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  duration: { color: colors.foreground, fontSize: 12, fontWeight: "600", marginTop: 1, fontVariant: ["tabular-nums"] },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  metaText: { color: colors.mutedForeground, fontSize: 12, flexShrink: 1 },
  priorityPill: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
}));
