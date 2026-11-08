export { NOTIFICATIONS_ROUTE, routeForNotification } from "./notificationRoute";
import { PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import type { CalendarItem } from "./types";
import { registerPushDevice, unregisterPushDevice } from "./api/notifications";
import { pushDelivers, pushProjectId, pushRecordText, readPushRecord, type PushRecord, type PushState } from "./pushStatus";
import { documentTextFile } from "./textFile";
import { LEGACY_OVERDUE_CATEGORY, LEGACY_PRIORITIZE_ACTION, NOTIFICATION_CATEGORIES } from "./notificationCategories";

const CHANNEL = "reminders";
const PREFIX = "timely-reminder:";
const HORIZON_DAYS = 60;
const MAX_SCHEDULED = 60;

type NotificationsModule = typeof import("expo-notifications");

let loaded: NotificationsModule | null | undefined;
let serverPush = false;
let lastPushToken: string | null = null;
let categoriesReady = false;

export type { PushState } from "./pushStatus";

// The token the server holds for this phone and whether it pushes to it,
// kept between runs: sign-out revokes the token even when this run never
// registered one, and the background check (a fresh JS run) skips alerts
// the server already pushed.
const tokenFile = documentTextFile("timely-push-token.json");

function storedPush(): PushRecord | null {
  try {
    return readPushRecord(tokenFile.read());
  } catch {
    return null;
  }
}

function savePush(record: PushRecord) {
  try {
    tokenFile.write(pushRecordText(record));
  } catch {
    // Sign-out still revokes the token this run holds.
  }
}

/** Push stopped working: the background check shows alerts again. The token stays for sign-out to revoke. */
function markPushOff() {
  serverPush = false;
  const stored = storedPush();
  if (stored?.on) savePush({ token: stored.token, on: false });
}

/** True when the server pushes alerts to this phone, in this run or as a registration an earlier run stored. */
export function isServerPushEnabled() {
  return pushDelivers(serverPush, storedPush());
}

/** Set by app.config.js from TIMELY_EAS_PROJECT_ID (pushConfig.js); absent in builds without a push project. */
function easProjectId() {
  return pushProjectId(Constants.expoConfig?.extra, Platform.OS);
}

/** expo-notifications, or null where it can't run (Expo Go, web). */
export function notificationsModule(): NotificationsModule | null {
  return notifications();
}

function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  // Expo Go (SDK 53+) throws if the Android push module is touched.
  // The web build has no device notifications, and most of the module throws there.
  if (Constants.appOwnership === "expo" || Platform.OS === "web") {
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
    await N.setNotificationChannelAsync("agent", { name: "Assistant", importance: N.AndroidImportance.DEFAULT, sound: "default" });
    await N.setNotificationChannelAsync("bots", { name: "Bot alerts", importance: N.AndroidImportance.DEFAULT, sound: "default" });
    await N.setNotificationChannelAsync(CHANNEL, {
      name: "Reminders",
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      enableVibrate: true,
    });
  }
  if (categoriesReady) return;
  // Buttons that act in the background (Done, Snooze, Start focus…) run in the
  // notification task in lib/background/register.ts without opening the app.
  await Promise.all([
    ...Object.entries(NOTIFICATION_CATEGORIES).map(([id, actions]) =>
      N.setNotificationCategoryAsync(
        id,
        actions.map((action) => ({
          identifier: action.id,
          buttonTitle: action.title,
          options: { opensAppToForeground: Boolean(action.opensApp) },
          ...(action.textInput
            ? { textInput: { placeholder: action.textInput.placeholder, submitButtonTitle: action.textInput.submit } }
            : {}),
        })),
      ),
    ),
    N.setNotificationCategoryAsync(LEGACY_OVERDUE_CATEGORY, [
      { identifier: LEGACY_PRIORITIZE_ACTION, buttonTitle: "Reschedule urgently", options: { opensAppToForeground: false } },
    ]),
  ]).catch(() => undefined);
  categoriesReady = true;
}

function clockTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "3:00 PM · Website relaunch" — when, and where the work lives. */
export function reminderBody(item: CalendarItem, at: number) {
  const parts = [clockTime(at)];
  const project = item.task?.project?.title;
  if (project) parts.push(project);
  if (item.task?.deadline) {
    const due = new Date(`${item.task.deadline.slice(0, 10)}T00:00:00`);
    const today = new Date(at);
    today.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) parts.push("due today");
    else if (days === 1) parts.push("due tomorrow");
    else if (days < 0) parts.push("overdue");
  }
  return parts.join(" · ");
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

/**
 * Registers this phone for instant push and says how it went. A build with
 * no Expo project id never asks for a token: it keeps checking for alerts in
 * the background (lib/serverNotifications.ts), with nothing broken.
 */
export async function registerServerPushState(): Promise<PushState> {
  const N = notifications();
  if (!N) {
    markPushOff();
    return "unsupported";
  }
  const allowed = await getNotificationPermission();
  if (!allowed.granted) {
    markPushOff();
    return "no_permission";
  }
  const projectId = easProjectId();
  if (!projectId) {
    markPushOff();
    return "no_project";
  }
  try {
    // The "bots" channel must exist before the first bot alert arrives.
    await ensureReminderChannel();
    const token = await N.getExpoPushTokenAsync({ projectId });
    if (!token?.data) throw new Error("no push token");
    lastPushToken = token.data;
    await registerPushDevice(token.data, Platform.OS === "ios" ? "ios" : "android");
    savePush({ token: token.data, on: true });
    serverPush = true;
    return "on";
  } catch {
    markPushOff();
    return "failed";
  }
}

export async function registerServerPush() {
  return (await registerServerPushState()) === "on";
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
        body: reminderBody(item, at),
        sound: "default" as const,
        categoryIdentifier: item.taskId ? "timely_reminder_local" : undefined,
        data: {
          taskId: item.taskId ?? "",
          kind: "reminder",
          start: item.start,
          // Done on a repeating reminder finishes this occurrence, not the series.
          originalStart: item.originalStart ?? (item.kind === "taskOccurrence" ? item.start : ""),
        },
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

/**
 * Revokes this phone's push token at sign-out. The stored token covers a run
 * that never registered one. The file goes only once the server dropped the
 * token; a failed call keeps it, marked off, and the next sign-in's
 * registration moves the server's row to that sign-in.
 */
export async function unregisterServerPush() {
  const token = lastPushToken ?? storedPush()?.token ?? null;
  lastPushToken = null;
  markPushOff();
  if (!token) return;
  try {
    await unregisterPushDevice(token);
  } catch {
    // Sign-out goes on; the token is revoked with the session (it belongs to it).
    return;
  }
  try {
    tokenFile.remove();
  } catch {
    // A file left behind only means a second, harmless revoke next time.
  }
}

const POMODORO_PREFIX = "timely-pomodoro:";

/** Rings when a Dashboard pomodoro phase ends, even with the app in the background. */
export async function schedulePomodoroNotification(cardId: string, at: number, title: string, body: string, sound = true) {
  const N = notifications();
  if (!N) return;
  await cancelPomodoroNotification(cardId);
  const current = await N.getPermissionsAsync();
  if (!current.granted && current.ios?.status !== N.IosAuthorizationStatus.PROVISIONAL) return;
  await ensureReminderChannel();
  try {
    await N.scheduleNotificationAsync({
      identifier: `${POMODORO_PREFIX}${cardId}`,
      content: { title, body, sound: sound ? ("default" as const) : false, data: { kind: "pomodoro" } },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNEL },
    });
  } catch {
    // A missed chime is not worth an error.
  }
}

export async function cancelPomodoroNotification(cardId: string) {
  const N = notifications();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(`${POMODORO_PREFIX}${cardId}`);
  } catch {
    // Nothing was scheduled.
  }
}
