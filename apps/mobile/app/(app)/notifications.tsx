import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { useState } from "react";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import ConfirmSheet from "../../components/ui/ConfirmSheet";
import {
  useClearNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsQuery,
  useSnoozeNotification,
  usePrioritizeOverdueTask,
  useNotificationTriage,
} from "../../lib/hooks";
import type { TriageStep } from "../../lib/api/decisions";
import type { AppNotification } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { needsNetworkCopy } from "../../lib/queryCopy";
import { routeForNotification } from "../../lib/notifications";
import { useToastStore } from "../../lib/toast";

function routeFor(item: AppNotification) {
  return routeForNotification({
    ...item.data,
    category: item.category,
    entityType: item.entityType ?? item.data?.entityType,
    entityId: item.entityId ?? item.data?.entityId,
  });
}

/** Other next steps for overdue or missed Work; smart suggestions may mark one
 * as suggested. "Reschedule urgently" keeps its own chip. */
const TRIAGE_STEPS: Record<string, { step: TriageStep; label: string }[]> = {
  overdue: [
    { step: "extend", label: "Deadline +1 week" },
    { step: "lower", label: "Lower priority" },
  ],
  missed: [
    { step: "addtime", label: "Add time" },
    { step: "move", label: "Move to next free time" },
    { step: "lower", label: "Lower priority" },
  ],
};

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
  const clearAll = useClearNotifications();
  const snooze = useSnoozeNotification();
  const prioritize = usePrioritizeOverdueTask();
  const triage = useNotificationTriage();
  const items = list.data ?? [];
  const networkCopy = needsNetworkCopy(list);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <Screen>
      <MobileHeader title="Notifications" back large={false} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isPending}
            onRefresh={() => void list.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.toolbar}>
          <AnimatedPressable
            onPress={() => void markAll.mutateAsync()}
            disabled={markAll.isPending || items.length === 0 || items.every((item) => item.readAt)}
            style={styles.markAll}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => setConfirmClear(true)}
            disabled={clearAll.isPending || items.length === 0}
            style={styles.markAll}
          >
            <Text style={styles.clearText}>Clear all</Text>
          </AnimatedPressable>
        </View>
        {clearAll.isError ? (
          <Text style={styles.meta}>Couldn't clear notifications. Try again.</Text>
        ) : null}
        {prioritize.isError ? (
          <Text style={styles.meta}>Couldn't reschedule the task. Try again.</Text>
        ) : null}
        {networkCopy && items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Couldn't load notifications"
            description={networkCopy}
            compact
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Due reminders and daily digests appear here, including when the app is closed."
            compact
          />
        ) : (
          items.map((item) => {
            const href = routeFor(item);
            return (
              <View key={item.id} style={[styles.row, !item.readAt && styles.unread]}>
                <AnimatedPressable
                  onPress={() => {
                    if (!item.readAt) void markRead.mutateAsync(item.id);
                    router.push(href as never);
                  }}
                >
                  <Text style={styles.title}>{item.title}</Text>
                  {item.body ? <Text style={styles.meta}>{item.body}</Text> : null}
                  <Text style={styles.stamp}>
                    {item.category} · {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </AnimatedPressable>
                {item.category === "reminder" ? (
                  <View style={styles.actions}>
                    <AnimatedPressable onPress={() => void snooze.mutateAsync({ id: item.id, minutes: 15 })} style={styles.chip}>
                      <Text style={styles.chipText}>15m</Text>
                    </AnimatedPressable>
                    <AnimatedPressable onPress={() => void snooze.mutateAsync({ id: item.id, minutes: 60 })} style={styles.chip}>
                      <Text style={styles.chipText}>1h</Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      onPress={() => void snooze.mutateAsync({ id: item.id, until: tomorrowNine() })}
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>Tomorrow 9:00</Text>
                    </AnimatedPressable>
                  </View>
                ) : null}
                {item.category === "overdue" || (item.category === "missed" && !item.readAt) ? (
                  <View style={styles.actions} testID="triage-steps">
                {item.category === "overdue" ? (
                  <AnimatedPressable
                    onPress={() => {
                      const taskId = item.entityId ?? item.data?.taskId;
                      if (typeof taskId !== "string" || !taskId) return;
                      void prioritize.mutateAsync(taskId).then((plan) => {
                        const placed = plan.proposals?.some((proposal) => proposal.taskId === (item.entityId ?? item.data?.taskId));
                        useToastStore.getState().show(placed ? "Rescheduled with urgent priority" : "Set to urgent; task wasn't moved");
                      }).catch(() => undefined);
                    }}
                    disabled={prioritize.isPending}
                    style={[styles.chip, item.data?.suggest === "reschedule" && styles.suggested]}
                  >
                    <Text style={[styles.chipText, item.data?.suggest === "reschedule" && styles.suggestedText]}>
                      {item.data?.suggest === "reschedule" ? "✦ " : ""}Reschedule urgently
                    </Text>
                  </AnimatedPressable>
                ) : null}
                {!item.readAt
                  ? (TRIAGE_STEPS[item.category] ?? []).map(({ step, label }) => {
                      const suggested = item.data?.suggest === step;
                      return (
                        <AnimatedPressable
                          key={step}
                          disabled={triage.isPending}
                          onPress={() =>
                            void triage
                              .mutateAsync({ id: item.id, action: step })
                              .then((res) => useToastStore.getState().show(res.message))
                              .catch(() => useToastStore.getState().show("Could not do that"))
                          }
                          style={[styles.chip, suggested && styles.suggested]}
                        >
                          <Text style={[styles.chipText, suggested && styles.suggestedText]}>
                            {suggested ? "✦ " : ""}
                            {label}
                          </Text>
                        </AnimatedPressable>
                      );
                    })
                  : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
      <ConfirmSheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all notifications?"
        message="This removes them from the list. It cannot be undone."
        confirmLabel="Clear all"
        onConfirm={() => void clearAll.mutateAsync().catch(() => undefined)}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  toolbar: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 16 },
  markAll: { alignSelf: "flex-end", paddingVertical: 4 },
  markAllText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  clearText: { color: colors.destructive, fontSize: 13, fontWeight: "600" },
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
  suggested: { borderColor: colors.primary },
  suggestedText: { color: colors.primary, fontWeight: "600" },
}));
