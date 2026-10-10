import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, X } from "lucide-react-native";
import { useState } from "react";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import ConfirmSheet from "../../components/ui/ConfirmSheet";
import {
  useClearNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsQuery,
  useSnoozeNotification,
  usePrioritizeOverdueTask,
  useNotificationTriage,
  useDecisionsStatusQuery,
} from "../../lib/hooks";
import type { AlertStep, TriageStep } from "../../lib/api/decisions";
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

/** The other steps an unread notification offers. They come with smart
 * suggestions, so without them there are none. A repeating task's missed
 * block only offers Lower priority: adding time or moving would change every
 * occurrence. */
function triageSteps(item: AppNotification, smart: boolean) {
  const steps = smart && !item.readAt ? (TRIAGE_STEPS[item.category] ?? []) : [];
  return item.category === "missed" && item.data?.recurring === true ? steps.filter(({ step }) => step === "lower") : steps;
}

const ALERT_STEP_LABEL: Record<AlertStep, string> = {
  review: "Review",
  clarify: "Clarify",
  focus: "Add to Focus",
  reschedule: "Find time",
};

/** The tasks a smart alert is about, as the server listed them. */
function alertItems(item: AppNotification): { id: string; name: string }[] {
  const raw = item.data?.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is { id: string; name: string } =>
      Boolean(entry) && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { name?: unknown }).name === "string",
  );
}

function alertStep(item: AppNotification): AlertStep | null {
  const step = item.data?.action;
  return typeof step === "string" && step in ALERT_STEP_LABEL ? (step as AlertStep) : null;
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
  const clearAll = useClearNotifications();
  const remove = useDeleteNotification();
  const snooze = useSnoozeNotification();
  const prioritize = usePrioritizeOverdueTask();
  const triage = useNotificationTriage();
  const smart = useDecisionsStatusQuery().data?.available === true;
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
            const steps = triageSteps(item, smart);
            return (
              <View key={item.id} style={[styles.row, !item.readAt && styles.unread]}>
                <View style={styles.head}>
                  <AnimatedPressable
                    style={styles.headText}
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
                  <AnimatedPressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss"
                    hitSlop={8}
                    disabled={remove.isPending}
                    style={styles.dismiss}
                    onPress={() =>
                      void remove.mutateAsync(item.id).catch((error) => {
                        useToastStore.getState().show(error instanceof Error ? error.message : "Could not dismiss that");
                      })
                    }
                  >
                    <X size={16} color={colors.mutedForeground} />
                  </AnimatedPressable>
                </View>
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
                {item.category === "suggestion" ? (
                  <SmartAlert
                    item={item}
                    pending={triage.isPending}
                    onRoute={(target) => router.push(target as never)}
                    onStep={(step) =>
                      triage
                        .mutateAsync({ id: item.id, action: step })
                        .then((res) => {
                          if (res.message) useToastStore.getState().show(res.message);
                        })
                        .catch((error) => {
                          useToastStore.getState().show(error instanceof Error ? error.message : "Could not do that");
                        })
                    }
                  />
                ) : null}
                {item.category === "overdue" || steps.length > 0 ? (
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
                {steps.map(({ step, label }) => {
                  const suggested = item.data?.suggest === step;
                  return (
                    <AnimatedPressable
                      key={step}
                      disabled={triage.isPending}
                      onPress={() =>
                        void triage
                          .mutateAsync({ id: item.id, action: step })
                          .then((res) => useToastStore.getState().show(res.message))
                          .catch((error) => useToastStore.getState().show(error instanceof Error ? error.message : "Could not do that"))
                      }
                      style={[styles.chip, suggested && styles.suggested]}
                    >
                      <Text style={[styles.chipText, suggested && styles.suggestedText]}>
                        {suggested ? "✦ " : ""}
                        {label}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
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

/** A smart alert: the tasks it groups, and the one next step smart
 * suggestions picked for it. */
function SmartAlert({
  item,
  pending,
  onRoute,
  onStep,
}: {
  item: AppNotification;
  pending: boolean;
  onRoute: (href: string) => void;
  onStep: (step: AlertStep) => Promise<void>;
}) {
  const items = alertItems(item);
  const step = alertStep(item);
  const inbox = item.data?.kind === "inbox";
  const projectId = typeof item.data?.projectId === "string" ? item.data.projectId : null;
  const open = (id: string) => onRoute(inbox ? "/(app)/inbox" : `/(app)/tasks/${id}`);
  if (items.length < 2 && !(step && !item.readAt)) return null;
  return (
    <View style={{ gap: 8 }} testID="smart-alert">
      {items.length > 1 ? (
        <View style={styles.actions}>
          {items.map((entry) => (
            <AnimatedPressable key={entry.id} onPress={() => open(entry.id)} style={styles.pill} accessibilityRole="button">
              <Text style={styles.pillText} numberOfLines={1}>
                {entry.name}
              </Text>
            </AnimatedPressable>
          ))}
        </View>
      ) : null}
      {step && !item.readAt ? (
        <View style={styles.actions}>
          <AnimatedPressable
            disabled={pending}
            onPress={() => {
              if (step === "review" || step === "clarify") {
                if (projectId) onRoute(`/(app)/projects/${projectId}`);
                else if (items[0]) open(items[0].id);
              }
              void onStep(step);
            }}
            style={[styles.chip, styles.suggested]}
            accessibilityLabel={`Suggested next step: ${ALERT_STEP_LABEL[step]}`}
          >
            <Text style={[styles.chipText, styles.suggestedText]}>✦ {ALERT_STEP_LABEL[step]}</Text>
          </AnimatedPressable>
        </View>
      ) : null}
    </View>
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
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  headText: { flex: 1 },
  dismiss: { padding: 2 },
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
  pill: { maxWidth: 220, borderRadius: 999, backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: colors.mutedForeground, fontSize: 12 },
}));
