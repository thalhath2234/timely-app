import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Sun } from "lucide-react-native";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import { PrimaryButton, SectionLabel } from "../../components/ui/primitives";
import { useSetTodayFocus, useStartFocus, useStopFocus, useTodayQuery } from "../../lib/hooks";
import { addCalendarDays, formatTime } from "../../lib/format";
import { colors } from "../../lib/theme";
import type { Task } from "../../lib/types";

function Row({ task, extra, onPress }: { task: Task; extra?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={styles.title}>{task.name}</Text>
      {extra ? <Text style={styles.meta}>{extra}</Text> : null}
    </Pressable>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const today = useTodayQuery();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const data = today.data;
  const open = (id: string) => router.push(`/(app)/tasks/${id}`);

  return (
    <Screen>
      <MobileHeader title="Today" />
      <ScrollView contentContainerStyle={styles.body}>
        {today.isLoading ? (
          <Text style={styles.meta}>Loading today…</Text>
        ) : !data ? (
          <EmptyState icon={Sun} title="Could not load today" description="Pull to retry later." />
        ) : (
          <>
            <Text style={styles.lede}>
              {data.inboxCount} in inbox · {data.completedToday.length} completed · {data.unfinished.length} unfinished
            </Text>
            {data.focusing ? (
              <View style={styles.focusCard}>
                <SectionLabel>Focusing</SectionLabel>
                <Text style={styles.title}>{data.focusing.name}</Text>
                <PrimaryButton label="Stop focus" onPress={() => void stopFocus.mutateAsync(data.focusing!.id)} />
              </View>
            ) : null}
            <SectionLabel>Today focus</SectionLabel>
            {data.todayFocus.length === 0 ? (
              <Text style={styles.meta}>Star tasks from a detail screen. Max 7, independent of deadlines.</Text>
            ) : (
              data.todayFocus.map((task) => (
                <View key={task.id} style={styles.focusRow}>
                  <View style={{ flex: 1 }}>
                    <Row task={task} onPress={() => open(task.id)} extra={task.priorityLevel ?? undefined} />
                  </View>
                  <Pressable onPress={() => void startFocus.mutateAsync(task.id)} style={styles.chip}>
                    <Text style={styles.chipText}>Start</Text>
                  </Pressable>
                </View>
              ))
            )}
            <SectionLabel>Scheduled</SectionLabel>
            {data.items.filter((item) => !item.reminder).length === 0 ? (
              <Text style={styles.meta}>Nothing on the calendar today.</Text>
            ) : (
              data.items
                .filter((item) => !item.reminder)
                .map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => item.taskId && open(item.taskId)}
                    style={styles.row}
                  >
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.meta}>{item.allDay ? "All day" : formatTime(item.start)}</Text>
                  </Pressable>
                ))
            )}
            {data.overdue.length > 0 ? (
              <>
                <SectionLabel>Overdue</SectionLabel>
                {data.overdue.map((task) => (
                  <Row key={task.id} task={task} extra={task.deadline ?? undefined} onPress={() => open(task.id)} />
                ))}
              </>
            ) : null}
            <SectionLabel>End of day</SectionLabel>
            {data.unfinished.map((task) => (
              <View key={task.id} style={styles.focusRow}>
                <View style={{ flex: 1 }}>
                  <Row task={task} onPress={() => open(task.id)} />
                </View>
                <Pressable
                  onPress={() => {
                    void setFocus.mutateAsync({ id: task.id, date: addCalendarDays(data.date, 1) });
                  }}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>Tomorrow</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  lede: { color: colors.mutedForeground, fontSize: 13 },
  focusCard: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  focusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: colors.foreground, fontSize: 15, flex: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  chipText: { color: colors.foreground, fontSize: 12 },
});
