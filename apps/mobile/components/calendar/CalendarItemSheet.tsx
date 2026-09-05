import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarClock, Check, Flag } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { formatRelativeDay, formatTimeRange, startOfDay } from "../../lib/format";
import BottomSheet from "../ui/BottomSheet";
import DateTimeSheet from "../ui/DateTimeSheet";
import { PrimaryButton } from "../ui/primitives";
import { itemColor, isTaskItem } from "./CalendarItemRow";
import { colors } from "../../lib/theme";
import { useState } from "react";

export default function CalendarItemSheet({
  item,
  onClose,
  onToggleComplete,
  onReschedule,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  onToggleComplete: (item: CalendarItem) => void;
  onReschedule: (item: CalendarItem, start: Date) => void;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  if (!item) return null;
  const task = isTaskItem(item);

  return (
    <>
      <BottomSheet open={Boolean(item)} onClose={onClose} title={item.title}>
        <View style={styles.meta}>
          <View style={[styles.swatch, { backgroundColor: itemColor(item) }]} />
          <Text style={styles.when}>
            {formatRelativeDay(startOfDay(new Date(item.start)))} · {item.allDay ? "All day" : formatTimeRange(item.start, item.end)}
          </Text>
        </View>
        {task ? (
          <PrimaryButton
            label={item.completedAt ? "Mark incomplete" : "Complete"}
            onPress={() => onToggleComplete(item)}
          />
        ) : null}
        <View style={{ height: 8 }} />
        <Pressable onPress={() => setPicking(true)} style={styles.row}>
          <CalendarClock size={18} color={colors.mutedForeground} />
          <Text style={styles.rowText}>Reschedule</Text>
        </Pressable>
        {item.taskId ? (
          <Pressable
            onPress={() => {
              onClose();
              router.push(`/(app)/tasks/${item.taskId}`);
            }}
            style={styles.row}
          >
            <Check size={18} color={colors.mutedForeground} />
            <Text style={styles.rowText}>Open task</Text>
          </Pressable>
        ) : null}
        {item.eventId ? (
          <Pressable
            onPress={() => {
              onClose();
              router.push(`/(app)/events/${item.eventId}`);
            }}
            style={styles.row}
          >
            <Flag size={18} color={colors.mutedForeground} />
            <Text style={styles.rowText}>Edit event</Text>
          </Pressable>
        ) : null}
      </BottomSheet>
      <DateTimeSheet
        open={picking}
        value={new Date(item.start)}
        onClose={() => setPicking(false)}
        onChange={(next) => {
          if (next) onReschedule(item, next);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  when: { color: colors.mutedForeground, fontSize: 13 },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { color: colors.foreground, fontSize: 15 },
});
