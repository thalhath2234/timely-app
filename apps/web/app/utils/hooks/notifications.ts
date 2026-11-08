import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getJobHealth,
  getNotificationSettings,
  listJobs,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  clearNotifications,
  deleteNotification,
  retryJob,
  snoozeNotification,
  unreadNotificationCount,
  setPushTextHidden,
  updateNotificationSettings,
} from "@/app/utils/api/notifications";
import type { NotificationSettings } from "@/app/_types/types";
import { calendarKey } from "@/app/utils/hooks/calendar";
import { tasksKey, todayKey } from "@/app/utils/hooks/tasks";

export const notificationsKey = ["notifications"] as const;
export const unreadNotificationsKey = ["notifications", "unread-count"] as const;
export const notificationSettingsKey = ["notification-settings"] as const;
export const jobsKey = ["jobs"] as const;
export const jobHealthKey = ["jobs", "health"] as const;

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: notificationsKey });
  queryClient.invalidateQueries({ queryKey: unreadNotificationsKey });
}

export function useNotifications(unread = false) {
  return useQuery({
    queryKey: [...notificationsKey, unread] as const,
    queryFn: () => listNotifications(unread),
    staleTime: 15_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: unreadNotificationsKey,
    queryFn: unreadNotificationCount,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useClearNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearNotifications,
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useSnoozeNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, minutes, until }: { id: string; minutes?: number; until?: string }) =>
      snoozeNotification(id, { minutes, until }),
    onSuccess: () => {
      invalidateNotifications(queryClient);
      queryClient.invalidateQueries({ queryKey: calendarKey });
      queryClient.invalidateQueries({ queryKey: tasksKey });
      queryClient.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationSettingsKey,
    queryFn: getNotificationSettings,
    staleTime: 60_000,
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NotificationSettings>) => updateNotificationSettings(data),
    onSuccess: (settings) => {
      queryClient.setQueryData(notificationSettingsKey, settings);
    },
  });
}

/** Turns "Hide alert text in push" on or off; the reply is the stored settings. */
export function useSetPushTextHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hidden: boolean) => setPushTextHidden(hidden),
    onSuccess: (settings) => {
      queryClient.setQueryData(notificationSettingsKey, settings);
    },
  });
}

// Jobs run on the server, so the list only learns that a retried job failed
// again, or that one finished, by asking. It asks while it is on screen.
const jobsPollMs = 10_000;

export function useFailedJobs() {
  return useQuery({
    queryKey: [...jobsKey, "failed"] as const,
    queryFn: () => listJobs("failed"),
    staleTime: 5_000,
    refetchInterval: jobsPollMs,
  });
}

export function useJobHealth() {
  return useQuery({
    queryKey: jobHealthKey,
    queryFn: getJobHealth,
    staleTime: 5_000,
    refetchInterval: jobsPollMs,
  });
}

export function useRetryJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryJob,
    // A refused retry (a newer run is waiting) changes the counts too.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      queryClient.invalidateQueries({ queryKey: jobHealthKey });
    },
  });
}
