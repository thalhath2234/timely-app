import { useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useCalendarQuery } from "../lib/hooks";
import { markNotificationRead } from "../lib/api/notifications";
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
      (taskId) => {
        router.push(`/(app)/tasks/${taskId}`);
      },
      (notificationId) => {
        void markNotificationRead(notificationId).catch(() => undefined);
      },
    );
  }, [router]);

  return null;
}
