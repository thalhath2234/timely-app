import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, Check } from "lucide-react-native";
import type { Task } from "../../lib/types";
import { formatDateAndTime, formatDueDate, formatDuration, formatRelativeDay, PRIORITY_META } from "../../lib/format";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { useWorkingHoursZone } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Dot } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { taskEntityColor } from "../../lib/entityColor";

function TaskCard({
  task,
  onToggle,
  selected,
  selecting,
  onSelect,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  selected?: boolean;
  selecting?: boolean;
  onSelect?: (task: Task) => void;
}) {
  const router = useRouter();
  const done = Boolean(task.completedAt);
  const overdue = isOverdue(task, todayInZone(useWorkingHoursZone()));
  const due = formatDueDate(task.deadline);
  const scheduled = task.scheduledOn || task.blocks?.[0]?.start;
  const scheduledLabel = scheduled
    ? /^\d{4}-\d{2}-\d{2}$/.test(scheduled)
      ? formatRelativeDay(new Date(Number(scheduled.slice(0, 4)), Number(scheduled.slice(5, 7)) - 1, Number(scheduled.slice(8, 10))))
      : formatDateAndTime(scheduled)
    : null;
  const timeLabel = overdue ? due : scheduledLabel ?? due;
  const durationLabel = !done && task.duration > 0 ? formatDuration(task.duration) : null;
  const priority = task.priorityLevel ? PRIORITY_META[task.priorityLevel] : null;
  const accent = overdue ? colors.destructive : (priority?.color ?? taskEntityColor(task));

  return (
    <View style={[styles.card, selected && styles.selected]}>
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        onPress={() => onToggle(task)}
        style={styles.check}
      >
        <View style={[styles.box, done && styles.boxOn]}>
          {done ? <Check size={12} color="#fff" /> : null}
        </View>
      </Pressable>
      <AnimatedPressable
        onPress={() => (selecting && onSelect ? onSelect(task) : router.push(`/(app)/tasks/${task.id}`))}
        onLongPress={() => onSelect?.(task)}
        style={styles.body}
      >
        <View style={styles.titleRow}>
          <Text numberOfLines={2} style={[styles.name, done && styles.done]}>
            {task.name}
          </Text>
          {durationLabel ? <Text style={styles.duration}>{durationLabel}</Text> : null}
        </View>
        <View style={styles.meta}>
          {priority && !done ? (
            <View style={[styles.priorityPill, { borderColor: `${priority.color}66`, backgroundColor: `${priority.color}22` }]}>
              <Text style={[styles.priorityText, { color: priority.color }]}>{priority.label}</Text>
            </View>
          ) : null}
          {task.status ? (
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
    </View>
  );
}

export default memo(TaskCard);

const styles = createThemedStyleSheet((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 20,
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
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  name: { flex: 1, minWidth: 0, color: colors.cardForeground, fontSize: 15, fontWeight: "700", lineHeight: 21 },
  duration: { color: colors.foreground, fontFamily: "SpaceMono", fontSize: 12, fontWeight: "700", marginTop: 1 },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  metaText: { color: colors.mutedForeground, fontSize: 12, flexShrink: 1 },
  priorityPill: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
}));
