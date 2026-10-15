import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useCalendarQuery, useInvalidateAll } from "../lib/hooks";
import { useToastStore } from "../lib/toast";
import { addNotificationResponseHandler } from "../lib/notificationActions";
import {
  notificationsSupported,
  registerServerPush,
  reminderHorizonDays,
  requestNotificationPermission,
  syncReminderNotifications,
} from "../lib/notifications";
import { addDays, startOfDay } from "../lib/format";

export default function ReminderNotifications() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
    return addNotificationResponseHandler((result) => {
      if (result.message) {
        useToastStore.getState().show(result.message);
        void invalidateRef.current().catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.unreadNotifications });
      if (result.route) router.push(result.route as never);
    });
  }, [router, queryClient]);

  return null;
}
