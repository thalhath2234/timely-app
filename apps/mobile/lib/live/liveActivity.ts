import { AppState } from "react-native";
import Constants from "expo-constants";
import {
  addLiveActionListener,
  hasTimelyAndroid,
  isLiveActivityRunning,
  stopLiveActivity,
  updateLiveActivity,
} from "../../modules/timely-android";
import { chatRequest } from "../api/chat";
import { getToday } from "../api/schedule";
import { stopFocus } from "../api/tasks";
import { pomodoroTimeLeft, selectActivePomodoros, usePomodoroStore } from "../pomodoroStore";
import { useScheduleActivity } from "../scheduleActivity";
import { useToastStore } from "../toast";
import { getToken } from "../auth/session";
import { pollServerNotifications } from "../serverNotifications";
import { LIVE_ACTIONS, isBusyChat, liveKey, liveModel, type LiveChat, type LiveFocus } from "./liveModel";

/**
 * Drives the live notification. The foreground service (modules/timely-android)
 * runs `runLiveActivityTask` as a headless JS task, which keeps JS timers
 * alive in the background and refreshes the notification until nothing runs.
 * The app also nudges it (`refreshLiveActivity`) when it starts something.
 */

const BUSY_TICK_MS = 6_000;
const IDLE_TICK_MS = 20_000;
const TODAY_EVERY_MS = 30_000;

let chats: LiveChat[] = [];
let focusing: LiveFocus | null = null;
let todayAt = 0;
let lastKey = "";
let refreshing: Promise<boolean> | null = null;

function scheme() {
  const value = Constants.expoConfig?.scheme;
  return (Array.isArray(value) ? value[0] : value) || "timelymobile";
}

async function signedIn() {
  try {
    return Boolean(await getToken());
  } catch {
    return false;
  }
}

async function loadChats() {
  try {
    const list = await chatRequest<LiveChat[]>("");
    chats = (list ?? []).map(({ id, title, status, phase }) => ({ id, title, status, phase }));
  } catch {
    // Keep the last list while offline.
  }
}

async function loadFocus(force: boolean) {
  if (!force && Date.now() - todayAt < TODAY_EVERY_MS) return;
  try {
    const today = await getToday();
    const task = today.focusing;
    focusing = task ? { id: task.id, name: task.name, focusStartedAt: task.focusStartedAt, focusPausedAt: task.focusPausedAt } : null;
    todayAt = Date.now();
  } catch {
    // Keep what we had.
  }
}

function pomodoros(now: number) {
  return selectActivePomodoros(usePomodoroStore.getState()).map((timer) => ({
    cardId: timer.cardId,
    phase: timer.phase,
    endsAt: timer.endsAt,
    leftMs: pomodoroTimeLeft(timer, now),
    taskId: timer.taskId ?? null,
    taskName: timer.taskName ?? null,
  }));
}

/** Rebuilds the notification from what is known; true while anything runs. */
function render() {
  const model = liveModel({
    now: Date.now(),
    chats,
    focusing,
    pomodoros: pomodoros(Date.now()),
    scheduling: useScheduleActivity.getState().status === "running",
    scheme: scheme(),
  });
  if (!model) {
    lastKey = "";
    if (isLiveActivityRunning()) stopLiveActivity();
    return false;
  }
  const key = liveKey(model);
  if (key !== lastKey || !isLiveActivityRunning()) {
    lastKey = key;
    updateLiveActivity(model);
  }
  return true;
}

/**
 * Fetches what runs on the server (Agent runs, task focus) and redraws.
 * `hint` lets the app pass what it just changed so the notification updates
 * before the next fetch.
 */
export function refreshLiveActivity(hint: { force?: boolean; focusing?: LiveFocus | null; chats?: LiveChat[] } = {}) {
  if (!hasTimelyAndroid()) return Promise.resolve(false);
  if (hint.focusing !== undefined) {
    focusing = hint.focusing;
    todayAt = Date.now();
  }
  if (hint.chats) chats = hint.chats;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!(await signedIn())) {
      chats = [];
      focusing = null;
      return render();
    }
    await Promise.all([loadChats(), loadFocus(Boolean(hint.force))]);
    return render();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Redraws from local state only (a pomodoro or Auto-schedule changed). */
export function redrawLiveActivity() {
  if (!hasTimelyAndroid()) return false;
  return render();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The headless task the live notification's service runs. */
export async function runLiveActivityTask() {
  while (isLiveActivityRunning()) {
    const active = await refreshLiveActivity({ force: AppState.currentState !== "active" });
    // The phone can't receive server push here, so new alerts (a finished
    // run, an overdue task) are fetched while the service keeps JS awake.
    await pollServerNotifications().catch(() => undefined);
    if (!active) break;
    await sleep(chats.some((chat) => isBusyChat(chat.status)) ? BUSY_TICK_MS : IDLE_TICK_MS);
  }
}

function dataOf(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/** Buttons on the live notification. Registered once at startup. */
export function listenForLiveActions() {
  return addLiveActionListener(({ id, data }) => {
    const args = dataOf(data);
    const store = usePomodoroStore.getState();
    const done = (message?: string) => {
      if (message && AppState.currentState === "active") useToastStore.getState().show(message);
      void refreshLiveActivity({ force: true });
    };
    switch (id) {
      case LIVE_ACTIONS.stopFocus:
        if (!args.taskId) return;
        focusing = null;
        render();
        void stopFocus(args.taskId)
          .then(() => done("Focus stopped"))
          .catch(() => done("Couldn't stop focus"));
        return;
      case LIVE_ACTIONS.pausePomodoro:
        if (args.cardId) store.pause(args.cardId);
        return void render();
      case LIVE_ACTIONS.resumePomodoro:
        if (args.cardId) store.start(args.cardId);
        return void render();
      case LIVE_ACTIONS.skipPomodoro:
        if (args.cardId) store.skip(args.cardId);
        return void render();
      case LIVE_ACTIONS.stopRun:
        if (!args.chatId) return;
        void chatRequest(`/${encodeURIComponent(args.chatId)}/stop`, "POST")
          .then(() => done("Run stopped"))
          .catch(() => done("Couldn't stop the run"));
        return;
    }
  });
}
