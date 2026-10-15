import { AppRegistry, Platform } from "react-native";

/**
 * Everything Android runs while the app is in the background or closed. Loaded
 * from the app's entry (index.ts) before expo-router, because headless tasks
 * and TaskManager tasks must exist the moment Android starts JS for them:
 *
 * - "TimelyLiveActivity": the live notification's foreground service keeps
 *   this running while an Assistant run, focus or pomodoro is going.
 * - Notification buttons (Done, Snooze, Reply...) tapped while the app isn't
 *   open (expo-notifications hands them to NOTIFICATION_TASK).
 * - A refresh every 15 minutes or so (WorkManager): new server alerts,
 *   widgets, and the live notification if something started elsewhere.
 * - The home screen widgets and their card picker.
 */

export const NOTIFICATION_TASK = "timely-notification-action";
export const REFRESH_TASK = "timely-background-refresh";

if (Platform.OS === "android") {
  const TaskManager = require("expo-task-manager") as typeof import("expo-task-manager");
  const { BackgroundTaskResult } = require("expo-background-task") as typeof import("expo-background-task");

  TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }) => {
    if (error || !data || typeof data !== "object" || !("actionIdentifier" in data)) return;
    const { handleQuickAction, quickActionFromResponse } = require("../notificationActions") as typeof import("../notificationActions");
    const input = quickActionFromResponse(data);
    if (input) await handleQuickAction(input);
  });

  TaskManager.defineTask(REFRESH_TASK, async () => {
    const { pollServerNotifications } = require("../serverNotifications") as typeof import("../serverNotifications");
    const { refreshAllWidgets } = require("../widgets/taskHandler") as typeof import("../widgets/taskHandler");
    const { refreshLiveActivity } = require("../live/liveActivity") as typeof import("../live/liveActivity");
    try {
      await Promise.all([pollServerNotifications().catch(() => 0), refreshAllWidgets(), refreshLiveActivity({ force: true })]);
      return BackgroundTaskResult.Success;
    } catch {
      return BackgroundTaskResult.Failed;
    }
  });

  AppRegistry.registerHeadlessTask("TimelyLiveActivity", () => async () => {
    const { runLiveActivityTask } = require("../live/liveActivity") as typeof import("../live/liveActivity");
    await runLiveActivityTask();
  });

  const { listenForLiveActions } = require("../live/liveActivity") as typeof import("../live/liveActivity");
  listenForLiveActions();

  const widgets = require("react-native-android-widget") as typeof import("react-native-android-widget");
  const { widgetTaskHandler } = require("../widgets/taskHandler") as typeof import("../widgets/taskHandler");
  const { WidgetConfigurationScreen } = require("../widgets/configure") as typeof import("../widgets/configure");
  widgets.registerWidgetTaskHandler(widgetTaskHandler);
  widgets.registerWidgetConfigurationScreen(WidgetConfigurationScreen);
}

let registered = false;

/** Called once signed in: background button taps and the 15-minute refresh. */
export async function registerBackgroundRefresh() {
  if (Platform.OS !== "android" || registered) return;
  registered = true;
  try {
    const Notifications = require("expo-notifications") as typeof import("expo-notifications");
    await Notifications.registerTaskAsync(NOTIFICATION_TASK);
  } catch {
    // Buttons still work while the app is open.
  }
  try {
    const BackgroundTask = require("expo-background-task") as typeof import("expo-background-task");
    await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: 15 });
  } catch {
    // Widgets still refresh every 30 minutes on their own.
  }
}
