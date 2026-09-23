import { PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import type { CalendarItem } from "./types";
import { registerPushDevice, unregisterPushDevice } from "./api/notifications";

const CHANNEL = "reminders";
export const OVERDUE_CATEGORY = "overdue_task";
export const PRIORITIZE_ACTION = "prioritize_urgent";
const PREFIX = "timely-reminder:";
const HORIZON_DAYS = 60;
const MAX_SCHEDULED = 60;

type NotificationsModule = typeof import("expo-notifications");
type NotificationResponse = import("expo-notifications").NotificationResponse;

let loaded: NotificationsModule | null | undefined;
let serverPush = false;
let lastPushToken: string | null = null;
let lastHandledResponseKey: string | null = null;

export function isServerPushEnabled() {
  return serverPush;
}

function easProjectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  // Expo Go (SDK 53+) throws if the Android push module is touched.
  if (Constants.appOwnership === "expo") {
    loaded = null;
    return null;
  }
  try {
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

async function requestAndroidPostNotifications() {
  if (Platform.OS !== "android") return true;
  const version = typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
  if (!Number.isFinite(version) || version < 33) return true;
  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function ensureReminderChannel() {
  const N = notifications();
  if (!N) return;
  if (Platform.OS === "android") {
    await N.setNotificationChannelAsync(CHANNEL, {
      name: "Reminders",
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      enableVibrate: true,
    });
  }
  await N.setNotificationCategoryAsync(OVERDUE_CATEGORY, [
    {
      identifier: PRIORITIZE_ACTION,
      buttonTitle: "Reschedule urgently",
      options: { opensAppToForeground: true },
    },
  ]);
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
  await requestAndroidPostNotifications();
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
    lastPushToken = token.data;
    await registerPushDevice(token.data, Platform.OS === "ios" ? "ios" : "android");
    serverPush = true;
    return true;
  } catch {
    serverPush = false;
    return false;
  }
}

export async function syncReminderNotifications(items: CalendarItem[]) {
  const N = notifications();
  if (!N) return 0;
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
    upcoming.map(async ({ item, at }) => {
      const content = {
        title: item.title || "Reminder",
        body: "Reminder",
        sound: "default" as const,
        data: { taskId: item.taskId ?? "", kind: "reminder" },
      };
      try {
        await N.scheduleNotificationAsync({
          identifier: reminderKey(item),
          content,
          trigger: {
            type: N.SchedulableTriggerInputTypes.DATE,
            date: new Date(at),
            channelId: CHANNEL,
          },
        });
      } catch {
        try {
          const seconds = Math.max(1, Math.round((at - Date.now()) / 1000));
          await N.scheduleNotificationAsync({
            identifier: reminderKey(item),
            content,
            trigger: {
              type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds,
              repeats: false,
              channelId: CHANNEL,
            },
          });
        } catch {
          // Skip reminders the OS will not accept (exact-alarm denied, etc).
        }
      }
    }),
  );

  return upcoming.length;
}

export async function unregisterServerPush() {
  const token = lastPushToken;
  lastPushToken = null;
  serverPush = false;
  if (!token) return;
  try {
    await unregisterPushDevice(token);
  } catch {
    // Sign-out should continue even if the push token is already gone.
  }
}

function dataString(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value ? value : null;
}

export function routeForNotification(data: Record<string, unknown>): string {
  const taskId = dataString(data, "taskId");
  if (taskId) return `/(app)/tasks/${taskId}`;

  const entityType = dataString(data, "entityType");
  const entityId = dataString(data, "entityId");
  if (entityType && entityId) {
    if (entityType === "task") return `/(app)/tasks/${entityId}`;
    if (entityType === "project") return `/(app)/projects/${entityId}`;
    if (entityType === "doc") return `/(app)/docs/${entityId}`;
    if (entityType === "sheet") return `/(app)/sheets/${entityId}`;
    if (entityType === "event") return `/(app)/events/${entityId}`;
  }

  const entityRoutes = [
    ["projectId", "projects"],
    ["docId", "docs"],
    ["sheetId", "sheets"],
    ["eventId", "events"],
  ] as const;
  for (const [key, segment] of entityRoutes) {
    const id = dataString(data, key);
    if (id) return `/(app)/${segment}/${id}`;
  }

  const category = dataString(data, "category") ?? dataString(data, "kind");
  if (category === "digest") return "/(app)/report";
  return "/(app)/today";
}

export function addReminderResponseListener(
  onRoute: (href: string) => void,
  onNotification?: (notificationId: string) => void,
  onPrioritize?: (taskId: string) => void,
) {
  const N = notifications();
  if (!N) return () => undefined;

  const handleResponse = (response: NotificationResponse) => {
    const responseId = response.notification.request.identifier;
    const responseKey = `${responseId}:${response.notification.date}:${response.actionIdentifier}`;
    if (responseKey === lastHandledResponseKey) return;
    lastHandledResponseKey = responseKey;
    const data = response.notification.request.content.data ?? {};
    const notificationId = data.notificationId;
    if (response.actionIdentifier === PRIORITIZE_ACTION) {
      const taskId = data.taskId;
      if (typeof taskId === "string" && taskId) {
        onPrioritize?.(taskId);
      }
      N.clearLastNotificationResponse();
      return;
    }
    if (typeof notificationId === "string" && notificationId) onNotification?.(notificationId);
    onRoute(routeForNotification(data));
    N.clearLastNotificationResponse();
  };

  const initial = N.getLastNotificationResponse();
  if (initial) handleResponse(initial);
  const sub = N.addNotificationResponseReceivedListener(handleResponse);
  return () => sub.remove();
}
