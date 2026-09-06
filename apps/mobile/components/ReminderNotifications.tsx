import { useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useCalendarQuery } from "../lib/hooks";
import {
  addReminderResponseListener,
  cancelReminderNotifications,
  notificationsSupported,
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
    void requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!calendar.data?.items) return;
    void syncReminderNotifications(calendar.data.items);
  }, [calendar.data?.items]);

  useEffect(() => {
    return addReminderResponseListener((taskId) => {
      router.push(`/(app)/tasks/${taskId}`);
    });
  }, [router]);

  useEffect(() => {
    return () => {
      void cancelReminderNotifications();
    };
  }, []);

  return null;
}
