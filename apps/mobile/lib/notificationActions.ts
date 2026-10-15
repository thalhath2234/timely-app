import { markNotificationRead, prioritizeOverdueTask, snoozeNotification } from "./api/notifications";
import { runNotificationTriage, type TriageStep } from "./api/decisions";
import { editTaskOccurrence, getTask, startFocus, updateTask } from "./api/tasks";
import { chatRequest } from "./api/chat";
import { LEGACY_PRIORITIZE_ACTION, NOTIFICATION_CATEGORIES } from "./notificationCategories";
import { routeForNotification } from "./notificationRoute";
import { notificationsModule } from "./notifications";

/**
 * Runs a notification's quick action: in the background (Android hands the
 * tap to the task in lib/background/register.ts) or from the app's own
 * response listener. Returns a route when the app should open there.
 */

const SNOOZE_PREFIX = "timely-snooze:";
const recent = new Set<string>();

export type QuickActionInput = {
  actionId: string;
  identifier: string;
  date?: number;
  data: Record<string, unknown>;
  title?: string;
  body?: string;
  categoryIdentifier?: string;
  userText?: string;
};

export type QuickActionResult = { route?: string; message?: string };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** The parts of an expo-notifications response (foreground or background task) we use. */
export function quickActionFromResponse(raw: unknown): QuickActionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const response = raw as {
    actionIdentifier?: string;
    userText?: string;
    notification?: { date?: number; request?: { identifier?: string; content?: Record<string, unknown> } };
  };
  const request = response.notification?.request;
  const content = request?.content ?? {};
  const rawData = content.data ?? (typeof content.dataString === "string" ? safeJson(content.dataString) : {});
  return {
    actionId: response.actionIdentifier ?? "",
    identifier: request?.identifier ?? "",
    date: response.notification?.date,
    data: rawData && typeof rawData === "object" ? (rawData as Record<string, unknown>) : {},
    title: text(content.title),
    body: text(content.body),
    categoryIdentifier: text(content.categoryIdentifier),
    userText: response.userText,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function dismiss(identifier: string) {
  const N = notificationsModule();
  if (!N || !identifier) return;
  await N.dismissNotificationAsync(identifier).catch(() => undefined);
}

async function complain(message: string, data: Record<string, unknown>) {
  const N = notificationsModule();
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: { title: message, body: "Open Timely to try again.", data },
    trigger: { channelId: "reminders" },
  }).catch(() => undefined);
}

async function completeTask(data: Record<string, unknown>): Promise<QuickActionResult> {
  const taskId = text(data.taskId) || (text(data.entityType) === "task" ? text(data.entityId) : "");
  if (!taskId) return { route: routeForNotification(data) };
  const originalStart = text(data.originalStart);
  if (originalStart) {
    await editTaskOccurrence(taskId, { originalStart, action: "complete" });
    return {};
  }
  const task = await getTask(taskId);
  if (task.recurrence) {
    const start = text(data.start);
    // Without the occurrence's start, finishing would end the whole series.
    if (!start) return { route: `/(app)/tasks/${taskId}` };
    await editTaskOccurrence(taskId, { originalStart: start, action: "complete" });
    return {};
  }
  await updateTask(taskId, { completedAt: new Date().toISOString() });
  return {};
}

async function snooze(input: QuickActionInput, minutes: number) {
  const N = notificationsModule();
  const notificationId = text(input.data.notificationId);
  if (notificationId && text(input.data.category) === "reminder") {
    await snoozeNotification(notificationId, { minutes }).catch(() => undefined);
  }
  if (!N) return;
  await N.scheduleNotificationAsync({
    identifier: `${SNOOZE_PREFIX}${input.identifier}`,
    content: {
      title: input.title || "Reminder",
      body: input.body ?? "",
      sound: "default",
      data: input.data,
      categoryIdentifier: input.categoryIdentifier || undefined,
    },
    trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: minutes * 60, repeats: false, channelId: "reminders" },
  });
}

function opensApp(actionId: string) {
  if (!actionId || actionId === "expo.modules.notifications.actions.DEFAULT" || actionId === "open") return true;
  return Object.values(NOTIFICATION_CATEGORIES).some((actions) => actions.some((action) => action.id === actionId && action.opensApp));
}

export async function handleQuickAction(input: QuickActionInput): Promise<QuickActionResult> {
  const key = `${input.identifier}:${input.date ?? ""}:${input.actionId}`;
  if (recent.has(key)) return {};
  recent.add(key);
  if (recent.size > 50) recent.delete(recent.values().next().value as string);

  const { data, actionId } = input;
  const route = routeForNotification(data);
  const notificationId = text(data.notificationId);
  const taskId = text(data.taskId) || (text(data.entityType) === "task" ? text(data.entityId) : "");
  const chatId = text(data.chatId) || (text(data.entityType) === "chat" ? text(data.entityId) : "");
  // A plain tap or an "Open" button: mark it read and go there.
  if (opensApp(actionId)) {
    if (notificationId) void markNotificationRead(notificationId).catch(() => undefined);
    return { route };
  }

  await dismiss(input.identifier);
  try {
    let result: QuickActionResult = {};
    if (actionId === "done") result = { message: "Marked done", ...(await completeTask(data)) };
    else if (actionId.startsWith("snooze:")) {
      const minutes = Number(actionId.slice(7)) || 10;
      await snooze(input, minutes);
      result = { message: minutes >= 60 ? `Snoozed for ${minutes / 60} h` : `Snoozed for ${minutes} min` };
    } else if (actionId === "focus" && taskId) {
      await startFocus(taskId);
      result = { message: "Focus started" };
    } else if ((actionId === "prioritize" || actionId === LEGACY_PRIORITIZE_ACTION) && taskId) {
      const plan = await prioritizeOverdueTask(taskId);
      const placed = plan.proposals?.some((proposal) => proposal.taskId === taskId);
      result = { message: placed ? "Rescheduled with urgent priority" : "Set to urgent; task wasn't moved" };
    } else if (actionId.startsWith("triage:") && notificationId) {
      const res = await runNotificationTriage(notificationId, actionId.slice(7) as TriageStep);
      result = { message: res.message };
    } else if (actionId === "reply" && chatId && input.userText?.trim()) {
      await chatRequest(`/${encodeURIComponent(chatId)}/messages`, "POST", {
        content: input.userText.trim(),
        requestId: `ntf-${Date.now().toString(36)}`,
      });
      result = { message: "Sent to the assistant" };
    } else if (actionId === "retry" && chatId) {
      await chatRequest(`/${encodeURIComponent(chatId)}/retry`, "POST");
      result = { message: "Trying again" };
    } else if (actionId === "dismiss") {
      // Nothing else to do; the alert is marked read below.
    } else return { route };
    if (notificationId && !actionId.startsWith("triage:")) await markNotificationRead(notificationId).catch(() => undefined);
    return result;
  } catch {
    await complain("Couldn't do that", data);
    return {};
  }
}

/**
 * The app's own listener for notification taps and buttons (and the tap that
 * launched it). Background button taps go to the task in lib/background.
 */
export function addNotificationResponseHandler(onResult: (result: QuickActionResult) => void) {
  const N = notificationsModule();
  if (!N) return () => undefined;
  const handle = (response: unknown) => {
    const input = quickActionFromResponse(response);
    if (!input) return;
    void handleQuickAction(input).then(onResult);
    N.clearLastNotificationResponse();
  };
  // The tap that launched the app. A background button (Done, Snooze) was
  // already run by the background task, so only taps that open the app count.
  const initial = N.getLastNotificationResponse();
  const launch = initial ? quickActionFromResponse(initial) : null;
  if (launch && opensApp(launch.actionId)) handle(initial);
  const sub = N.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
