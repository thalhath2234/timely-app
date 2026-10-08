/**
 * Pomodoro timers from the Report dashboard, kept at app level so a timer
 * keeps running after leaving the Report screen. One timer per pomodoro card,
 * keyed by card id, saved on the device so a restart keeps the clock. The end
 * of each phase is also scheduled as a local notification, so it rings while
 * the app is in the background.
 *
 * Anything that shows running work reads `usePomodoroStore` with
 * `selectActivePomodoros` and drives a timer through the store's actions
 * (`start`, `pause`, `skip`, `reset`); the time left is
 * `pomodoroTimeLeft(timer, Date.now())`.
 */
import { AppState } from "react-native";
import { File, Paths } from "expo-file-system";
import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import {
  advancePomodoro,
  initialPomodoro,
  pomodoroRemaining,
  pomodoroSettings,
  type PomodoroPhase,
  type PomodoroSettings,
  type PomodoroState,
} from "@timely/contract/dashboard";
import { todayInZone } from "@timely/contract/workStatus";
import { startFocus, stopFocus } from "./api/tasks";
import {
  cancelPomodoroNotification,
  getNotificationPermission,
  requestNotificationPermission,
  schedulePomodoroNotification,
} from "./notifications";

export interface PomodoroTimer extends PomodoroState {
  cardId: string;
  /** The card's settings as last seen, so phases run their length off the Report screen too. */
  settings: PomodoroSettings;
  /** Name of the linked task, for surfaces that don't load tasks. */
  taskName?: string | null;
  /** Working hours zone, for counting sessions per day. */
  timeZone?: string;
}

type PomodoroStore = {
  timers: Record<string, PomodoroTimer>;
  /** Registers a card (or refreshes its settings) without touching a running clock. */
  sync: (cardId: string, settings: Record<string, unknown> | undefined, timeZone?: string) => void;
  start: (cardId: string) => void;
  pause: (cardId: string) => void;
  reset: (cardId: string) => void;
  /** Ends the phase early; a skipped focus round does not count. */
  skip: (cardId: string) => void;
  setPhase: (cardId: string, phase: PomodoroPhase) => void;
  linkTask: (cardId: string, task: { id: string; name: string } | null) => void;
  /** Finishes every phase whose time is up. The store's own ticker calls it. */
  tick: (now: number) => void;
};

const storeFile = new File(Paths.document, "timely-pomodoro.json");

function load(): Record<string, PomodoroTimer> {
  try {
    if (!storeFile.exists) return {};
    const parsed = JSON.parse(storeFile.textSync()) as Record<string, PomodoroTimer>;
    const timers: Record<string, PomodoroTimer> = {};
    for (const [cardId, timer] of Object.entries(parsed)) {
      timers[cardId] = {
        ...initialPomodoro(),
        ...timer,
        cardId,
        settings: pomodoroSettings(timer.settings as unknown as Record<string, unknown>),
        history: timer.history ?? {},
      };
    }
    return timers;
  } catch {
    return {};
  }
}

function persist(timers: Record<string, PomodoroTimer>) {
  try {
    storeFile.write(JSON.stringify(timers));
  } catch {
    // The timer still runs; it just won't survive a restart.
  }
}

let queryClient: QueryClient | null = null;

/** Lets the store refresh task data after it starts or stops time tracking. */
export function bindPomodoroQueryClient(client: QueryClient) {
  queryClient = client;
}

function refreshTask(taskId: string) {
  if (!queryClient) return;
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: ["today"] });
  void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
}

/** Tracks time on the linked task while a focus phase runs. Failures stay quiet: the timer matters more. */
function trackFocus(timer: PomodoroTimer, action: "start" | "stop") {
  if (!timer.taskId || timer.phase !== "focus") return;
  const call = action === "start" ? startFocus : stopFocus;
  void call(timer.taskId)
    .then(() => refreshTask(timer.taskId!))
    .catch(() => undefined);
}

/** Schedules the end-of-phase alert for a running timer, or clears it for a stopped one. */
function scheduleAlert(timer: PomodoroTimer) {
  if (timer.endsAt === null) {
    void cancelPomodoroNotification(timer.cardId);
    return;
  }
  const focus = timer.phase === "focus";
  void schedulePomodoroNotification(
    timer.cardId,
    timer.endsAt,
    focus ? "Focus round done" : "Break over",
    focus ? "Time for a break." : "Back to focus.",
    timer.settings.sound,
  );
}

let ticker: ReturnType<typeof setInterval> | null = null;

/** Runs a light ticker only while some timer is counting down. */
function ensureTicker(timers: Record<string, PomodoroTimer>) {
  const running = Object.values(timers).some((timer) => timer.endsAt !== null);
  if (running && ticker === null) {
    ticker = setInterval(() => usePomodoroStore.getState().tick(Date.now()), 1000);
  } else if (!running && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

export const usePomodoroStore = create<PomodoroStore>((set, get) => {
  const write = (cardId: string, change: (timer: PomodoroTimer) => PomodoroTimer) => {
    const current = get().timers[cardId];
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    const timers = { ...get().timers, [cardId]: next };
    set({ timers });
    persist(timers);
    ensureTicker(timers);
    if (next.endsAt !== current.endsAt) scheduleAlert(next);
  };

  const finish = (timer: PomodoroTimer, completed: boolean, now: number): PomodoroTimer => {
    trackFocus(timer, "stop");
    const next: PomodoroTimer = { ...timer, ...advancePomodoro(timer, timer.settings, completed, todayInZone(timer.timeZone), now) };
    if (next.endsAt !== null) trackFocus(next, "start");
    return next;
  };

  return {
    timers: load(),
    sync: (cardId, settings, timeZone) => {
      const existing = get().timers[cardId];
      const parsed = pomodoroSettings(settings);
      if (existing && JSON.stringify(existing.settings) === JSON.stringify(parsed) && existing.timeZone === timeZone) return;
      const timers = {
        ...get().timers,
        [cardId]: existing ? { ...existing, settings: parsed, timeZone } : { ...initialPomodoro(), cardId, settings: parsed, timeZone },
      };
      set({ timers });
      persist(timers);
      ensureTicker(timers);
    },
    start: (cardId) => {
      void getNotificationPermission()
        .then((permission) => {
          if (permission.granted || !permission.canAskAgain) return;
          return requestNotificationPermission().then((granted) => {
            // The alert was skipped while permission was pending; schedule it now.
            const timer = get().timers[cardId];
            if (granted && timer?.endsAt) scheduleAlert(timer);
          });
        })
        .catch(() => undefined);
      write(cardId, (timer) => {
        if (timer.endsAt !== null) return timer;
        const now = Date.now();
        trackFocus(timer, "start");
        return { ...timer, endsAt: now + pomodoroRemaining(timer, timer.settings, now), remaining: null };
      });
    },
    pause: (cardId) =>
      write(cardId, (timer) => {
        if (timer.endsAt === null) return timer;
        trackFocus(timer, "stop");
        return { ...timer, endsAt: null, remaining: pomodoroRemaining(timer, timer.settings, Date.now()) };
      }),
    reset: (cardId) =>
      write(cardId, (timer) => {
        if (timer.endsAt !== null) trackFocus(timer, "stop");
        return { ...timer, endsAt: null, remaining: null };
      }),
    skip: (cardId) => write(cardId, (timer) => finish(timer, false, Date.now())),
    setPhase: (cardId, phase) =>
      write(cardId, (timer) => {
        if (timer.phase === phase) return timer;
        if (timer.endsAt !== null) trackFocus(timer, "stop");
        return { ...timer, phase, endsAt: null, remaining: null };
      }),
    linkTask: (cardId, task) =>
      write(cardId, (timer) => {
        if (timer.endsAt !== null) trackFocus(timer, "stop");
        const next = { ...timer, taskId: task?.id ?? null, taskName: task?.name ?? null };
        if (next.endsAt !== null) trackFocus(next, "start");
        return next;
      }),
    tick: (now) => {
      const due = Object.values(get().timers).filter((timer) => timer.endsAt !== null && timer.endsAt <= now);
      if (due.length === 0) return;
      const timers = { ...get().timers };
      for (const timer of due) {
        const next = finish(timer, true, now);
        timers[timer.cardId] = next;
        // The finished phase's alert has fired; an auto-started one needs its own.
        if (next.endsAt !== null) scheduleAlert(next);
      }
      set({ timers });
      persist(timers);
      ensureTicker(timers);
    },
  };
});

/** Time left in a timer's phase, in ms. */
export function pomodoroTimeLeft(timer: PomodoroTimer, now: number) {
  return pomodoroRemaining(timer, timer.settings, now);
}

/** Timers that are counting down or paused mid-phase. */
export function selectActivePomodoros(state: { timers: Record<string, PomodoroTimer> }): PomodoroTimer[] {
  return Object.values(state.timers).filter((timer) => timer.endsAt !== null || timer.remaining !== null);
}

/** Drops a removed card's timer. */
export function forgetPomodoro(cardId: string) {
  const { timers } = usePomodoroStore.getState();
  const timer = timers[cardId];
  if (!timer) return;
  if (timer.endsAt !== null) trackFocus(timer, "stop");
  void cancelPomodoroNotification(cardId);
  const next = { ...timers };
  delete next[cardId];
  usePomodoroStore.setState({ timers: next });
  persist(next);
  ensureTicker(next);
}

// A timer that was running before a restart picks up where it left off,
// including a phase that ended while the app was closed. Timers pause in the
// background, so catch up as soon as the app comes back.
ensureTicker(usePomodoroStore.getState().timers);
AppState.addEventListener("change", (state) => {
  if (state === "active") usePomodoroStore.getState().tick(Date.now());
});
