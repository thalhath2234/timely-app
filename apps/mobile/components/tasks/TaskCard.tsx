import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, Check, Flag } from "lucide-react-native";
import type { Task } from "../../lib/types";
import { formatDueDate, isOverdue, PRIORITY_META } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Dot } from "../ui/primitives";

export default function TaskCard({
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
  const overdue = isOverdue(task.deadline, task.completedAt);
  const due = formatDueDate(task.deadline);
  const priority = task.priorityLevel ? PRIORITY_META[task.priorityLevel] : null;

  return (
    <View style={[styles.card, selected && styles.selected]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        onPress={() => onToggle(task)}
        style={styles.check}
      >
        <View style={[styles.box, done && styles.boxOn]}>{done ? <Check size={14} color={colors.primaryForeground} /> : null}</View>
      </Pressable>
      <Pressable
        onPress={() => (selecting && onSelect ? onSelect(task) : router.push(`/(app)/tasks/${task.id}`))}
        onLongPress={() => onSelect?.(task)}
        style={styles.body}
      >
        <Text numberOfLines={1} style={[styles.name, done && styles.done]}>
          {task.name}
        </Text>
        <View style={styles.meta}>
          {task.status ? (
            <View style={styles.metaItem}>
              <Dot color={task.status.color} />
              <Text style={styles.metaText}>{task.status.name}</Text>
            </View>
          ) : null}
          {priority && !done ? (
            <View style={styles.metaItem}>
              <Flag size={11} color={priority.color} />
              <Text style={[styles.metaText, { color: priority.color }]}>{priority.label}</Text>
            </View>
          ) : null}
          {due ? (
            <View style={styles.metaItem}>
              <CalendarDays size={11} color={overdue ? colors.destructive : colors.mutedForeground} />
              <Text style={[styles.metaText, overdue && { color: colors.destructive, fontWeight: "600" }]}>{due}</Text>
            </View>
          ) : null}
          {(task.labels ?? []).slice(0, 4).map((l) => (
            <Dot key={l.id} color={l.color} />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.primary },
  check: { width: 48, alignItems: "center", justifyContent: "center" },
  box: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { flex: 1, minHeight: 56, justifyContent: "center", paddingVertical: 10, paddingRight: 12, gap: 4 },
  name: { color: colors.cardForeground, fontSize: 15, fontWeight: "500" },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.mutedForeground, fontSize: 12 },
}));
