import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import type { CalendarItem } from "./types";
import { registerPushDevice } from "./api/notifications";

const CHANNEL = "reminders";
const PREFIX = "timely-reminder:";
const HORIZON_DAYS = 60;
const MAX_SCHEDULED = 60;

type NotificationsModule = typeof import("expo-notifications");

let loaded: NotificationsModule | null | undefined;
let serverPush = false;

export function isServerPushEnabled() {
  return serverPush;
}

function easProjectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (!NativeModules.ExpoPushTokenManager) {
    loaded = null;
    return null;
  }
  try {
    // Native module is only in a rebuild after expo-notifications was added.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-notifications") as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    loaded = mod;
    return loaded;
  } catch {
    loaded = null;
    return null;
  }
}

export const REMINDER_CHANNEL = CHANNEL;

export function reminderHorizonDays() {
  return HORIZON_DAYS;
}

export function isReminderItem(item: CalendarItem) {
  return Boolean(
    item.reminder ||
      item.id.endsWith("@reminder") ||
      ((item.kind === "task" || item.kind === "taskOccurrence") && (item.task?.duration ?? 1) <= 0),
  );
}

export function notificationsSupported() {
  return (Platform.OS === "ios" || Platform.OS === "android") && notifications() !== null;
}

export async function ensureReminderChannel() {
  const N = notifications();
  if (!N || Platform.OS !== "android") return;
  await N.setNotificationChannelAsync(CHANNEL, {
    name: "Reminders",
    importance: N.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
    enableVibrate: true,
  });
}

export async function getNotificationPermission() {
  const N = notifications();
  if (!N) return { granted: false, canAskAgain: false };
  const current = await N.getPermissionsAsync();
  return {
    granted: current.granted || current.ios?.status === N.IosAuthorizationStatus.PROVISIONAL,
    canAskAgain: current.canAskAgain,
  };
}

export async function requestNotificationPermission() {
  const N = notifications();
  if (!N) return false;
  await ensureReminderChannel();
  const current = await N.getPermissionsAsync();
  if (current.granted || current.ios?.status === N.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const next = await N.requestPermissionsAsync();
  return next.granted || next.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;
}

function reminderKey(item: CalendarItem) {
  return `${PREFIX}${item.id}`;
}

export async function cancelReminderNotifications() {
  const N = notifications();
  if (!N) return;
  const existing = await N.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((item) => item.identifier.startsWith(PREFIX))
      .map((item) => N.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export async function registerServerPush() {
  const N = notifications();
  if (!N) return false;
  const allowed = await getNotificationPermission();
  if (!allowed.granted) return false;
  try {
    const projectId = easProjectId();
    const token = projectId
      ? await N.getExpoPushTokenAsync({ projectId })
      : await N.getExpoPushTokenAsync();
    if (!token?.data) return false;
    await registerPushDevice(token.data, Platform.OS === "ios" ? "ios" : "android");
    serverPush = true;
    await cancelReminderNotifications();
    return true;
  } catch {
    serverPush = false;
    return false;
  }
}

export async function syncReminderNotifications(items: CalendarItem[]) {
  const N = notifications();
  if (!N) return 0;
  if (serverPush) {
    await cancelReminderNotifications();
    return 0;
  }
  const allowed = await getNotificationPermission();
  if (!allowed.granted) {
    await cancelReminderNotifications();
    return 0;
  }
  await ensureReminderChannel();

  const now = Date.now() + 5_000;
  const upcoming = items
    .filter((item) => isReminderItem(item) && !item.completedAt && !item.allDay)
    .map((item) => ({ item, at: new Date(item.start).getTime() }))
    .filter(({ at }) => Number.isFinite(at) && at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED);

  await cancelReminderNotifications();

  await Promise.all(
    upcoming.map(({ item, at }) =>
      N.scheduleNotificationAsync({
        identifier: reminderKey(item),
        content: {
          title: item.title || "Reminder",
          body: "Reminder",
          sound: "default",
          data: { taskId: item.taskId ?? "", kind: "reminder" },
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: new Date(at),
          channelId: CHANNEL,
        },
      }),
    ),
  );

  return upcoming.length;
}

export function addReminderResponseListener(
  onTask: (taskId: string) => void,
  onNotification?: (notificationId: string) => void,
) {
  const N = notifications();
  if (!N) return () => undefined;
  const sub = N.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data ?? {};
    const notificationId = data.notificationId;
    if (typeof notificationId === "string" && notificationId) onNotification?.(notificationId);
    const taskId = data.taskId;
    if (typeof taskId === "string" && taskId) onTask(taskId);
  });
  return () => sub.remove();
}
