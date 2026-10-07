import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ban, CalendarClock, Check, Flag, RotateCcw } from "lucide-react-native";
import type { CalendarItem } from "../../lib/types";
import { formatRelativeDay, formatTime, formatTimeRange, startOfDay } from "../../lib/format";
import BottomSheet from "../ui/BottomSheet";
import DateTimeSheet from "../ui/DateTimeSheet";
import { PrimaryButton } from "../ui/primitives";
import { itemColor, isReminderItem, isTaskItem } from "./CalendarItemRow";
import { useEditEventOccurrence, useEditTaskOccurrence } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
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
  const editTaskOcc = useEditTaskOccurrence();
  const editEventOcc = useEditEventOccurrence();
  if (!item) return null;
  const task = isTaskItem(item);
  const occurrence = item.kind === "taskOccurrence" || item.kind === "eventOccurrence";

  function runOccurrence(action: "skip" | "restore") {
    if (!item?.originalStart) return;
    if (item.kind === "taskOccurrence" && item.taskId) {
      editTaskOcc.mutate({ id: item.taskId, originalStart: item.originalStart, action });
    } else if (item.kind === "eventOccurrence" && item.eventId) {
      editEventOcc.mutate({ id: item.eventId, originalStart: item.originalStart, action });
    }
    onClose();
  }

  return (
    <>
      <BottomSheet open={Boolean(item)} onClose={onClose} title={item.title}>
        <View style={styles.meta}>
          <View style={[styles.swatch, { backgroundColor: itemColor(item) }]} />
          <Text style={styles.when}>
            {formatRelativeDay(startOfDay(new Date(item.start)), undefined)} ·{" "}
            {item.allDay
              ? "All day"
              : isReminderItem(item)
                ? `${formatTime(item.start)} · Reminder`
                : formatTimeRange(item.start, item.end)}
          </Text>
        </View>
        {task ? (
          <PrimaryButton
            label={item.completedAt ? "Mark incomplete" : occurrence ? "Complete this day" : "Complete"}
            onPress={() => onToggleComplete(item)}
          />
        ) : null}
        <View style={{ height: 8 }} />
        <Pressable onPress={() => setPicking(true)} style={styles.row}>
          <CalendarClock size={18} color={colors.mutedForeground} />
          <Text style={styles.rowText}>Reschedule</Text>
        </Pressable>
        {occurrence && item.originalStart ? (
          <>
            <Pressable onPress={() => runOccurrence("skip")} style={styles.row}>
              <Ban size={18} color={colors.mutedForeground} />
              <Text style={styles.rowText}>Skip this day</Text>
            </Pressable>
            {item.moved || item.completedAt ? (
              <Pressable onPress={() => runOccurrence("restore")} style={styles.row}>
                <RotateCcw size={18} color={colors.mutedForeground} />
                <Text style={styles.rowText}>Restore original</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
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

const styles = createThemedStyleSheet((colors) => ({
  meta: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16, minHeight: 52, borderRadius: 18, backgroundColor: colors.muted, paddingHorizontal: 16 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  when: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 16, backgroundColor: colors.muted, marginBottom: 4 },
  rowText: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
}));
