import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsQuery,
  useSnoozeNotification,
} from "../../lib/hooks";
import type { AppNotification } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function taskIdOf(item: AppNotification) {
  const fromData = item.data?.taskId;
  if (typeof fromData === "string" && fromData) return fromData;
  if (item.entityType === "task" && item.entityId) return item.entityId;
  return null;
}

function tomorrowNine() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const list = useNotificationsQuery();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const snooze = useSnoozeNotification();
  const items = list.data ?? [];

  return (
    <Screen>
      <MobileHeader title="Notifications" back large={false} />
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable
          onPress={() => void markAll.mutateAsync()}
          disabled={markAll.isPending || items.every((item) => item.readAt)}
          style={styles.markAll}
        >
          <Text style={styles.markAllText}>Mark all read</Text>
        </Pressable>
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Due reminders and daily digests appear here, including when the app is closed."
            compact
          />
        ) : (
          items.map((item) => {
            const taskId = taskIdOf(item);
            return (
              <View key={item.id} style={[styles.row, !item.readAt && styles.unread]}>
                <Pressable
                  onPress={() => {
                    if (!item.readAt) void markRead.mutateAsync(item.id);
                    if (taskId) router.push(`/(app)/tasks/${taskId}`);
                  }}
                >
                  <Text style={styles.title}>{item.title}</Text>
                  {item.body ? <Text style={styles.meta}>{item.body}</Text> : null}
                  <Text style={styles.stamp}>
                    {item.category} · {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </Pressable>
                {item.category === "reminder" ? (
                  <View style={styles.actions}>
                    <Pressable onPress={() => void snooze.mutateAsync({ id: item.id, minutes: 15 })} style={styles.chip}>
                      <Text style={styles.chipText}>15m</Text>
                    </Pressable>
                    <Pressable onPress={() => void snooze.mutateAsync({ id: item.id, minutes: 60 })} style={styles.chip}>
                      <Text style={styles.chipText}>1h</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void snooze.mutateAsync({ id: item.id, until: tomorrowNine() })}
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>Tomorrow 9:00</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  markAll: { alignSelf: "flex-end", paddingVertical: 4 },
  markAllText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    backgroundColor: colors.card,
  },
  unread: { borderColor: colors.primary },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 13, marginTop: 4 },
  stamp: { color: colors.mutedForeground, fontSize: 11, marginTop: 6, textTransform: "uppercase" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: colors.foreground, fontSize: 12 },
}));
