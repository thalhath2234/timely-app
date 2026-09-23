import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "expo-router";
import { useCalendarQuery, useInvalidateAll } from "../lib/hooks";
import { markNotificationRead } from "../lib/api/notifications";
import { prioritizeOverdueTask } from "../lib/api/notifications";
import { useToastStore } from "../lib/toast";
import {
  addReminderResponseListener,
  notificationsSupported,
  registerServerPush,
  reminderHorizonDays,
  requestNotificationPermission,
  syncReminderNotifications,
} from "../lib/notifications";
import { addDays, startOfDay } from "../lib/format";

export default function ReminderNotifications() {
  const router = useRouter();
  const invalidate = useInvalidateAll();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const day = startOfDay(new Date()).getTime();
  const range = useMemo(() => {
    const from = new Date(day);
    return { from, to: addDays(from, reminderHorizonDays()) };
  }, [day]);
  const calendar = useCalendarQuery(range.from, range.to);

  useEffect(() => {
    if (!notificationsSupported()) return;
    let cancelled = false;
    void (async () => {
      const granted = await requestNotificationPermission();
      if (!granted || cancelled) return;
      await registerServerPush();
      if (calendar.data?.items) await syncReminderNotifications(calendar.data.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [calendar.data?.items]);

  useEffect(() => {
    return addReminderResponseListener(
      (href) => {
        router.push(href as never);
      },
      (notificationId) => {
        void markNotificationRead(notificationId).catch(() => undefined);
      },
      (taskId) => {
        void prioritizeOverdueTask(taskId)
          .then((plan) => {
            void invalidateRef.current().catch(() => undefined);
            const placed = plan.proposals?.some((proposal) => proposal.taskId === taskId);
            useToastStore.getState().show(placed ? "Rescheduled with urgent priority" : "Set to urgent; task wasn't moved");
            router.push(`/(app)/tasks/${taskId}`);
          })
          .catch((error: unknown) => {
            useToastStore.getState().show(error instanceof Error ? error.message : "Could not reschedule task");
            router.push(`/(app)/tasks/${taskId}`);
          });
      },
    );
  }, [router]);

  return null;
}
