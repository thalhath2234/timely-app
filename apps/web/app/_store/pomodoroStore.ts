"use client";

/**
 * Pomodoro timers from the Dashboard, kept at app level so a timer
 * keeps running, finishes its phase and chimes on any page, not just while
 * the Dashboard is open. One timer per pomodoro card, keyed by card id, and
 * saved on this device so a reload keeps the clock.
 *
 * Anything that shows running work (the Activity island, for one) reads
 * `usePomodoroStore(useShallow(selectActivePomodoros))` and drives a timer
 * through the store's actions (`start`, `pause`, `skip`, `reset`); the time
 * left is `pomodoroTimeLeft(timer, Date.now())`.
 */
import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import {
  adjustPomodoro,
  advancePomodoro,
  initialPomodoro,
  pomodoroRemaining,
  pomodoroSettings,
  type PomodoroPhase,
  type PomodoroSettings,
  type PomodoroState,
} from "@timely/contract/dashboard";
import { todayInZone } from "@timely/contract/workStatus";
import { startFocus, stopFocus } from "@/app/utils/api/tasks";
import { chime, notify } from "@/app/utils/chime";

export interface PomodoroTimer extends PomodoroState {
  cardId: string;
  /** The card's settings as last seen, so phases run their length off the Dashboard too. */
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
  /** Adds (or takes off) time on a running or paused phase; the settings stay as they are. */
  adjust: (cardId: string, deltaMs: number) => void;
  linkTask: (cardId: string, task: { id: string; name: string } | null) => void;
  /** Finishes every phase whose time is up. The store's own ticker calls it. */
  tick: (now: number) => void;
};

const STORAGE_KEY = "timely.report.pomodoro";

function load(): Record<string, PomodoroTimer> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PomodoroTimer>;
    const timers: Record<string, PomodoroTimer> = {};
    for (const [cardId, timer] of Object.entries(parsed)) {
      timers[cardId] = { ...initialPomodoro(), ...timer, cardId, settings: pomodoroSettings(timer.settings as unknown as Record<string, unknown>), history: timer.history ?? {} };
    }
    return timers;
  } catch {
    return {};
  }
}

function persist(timers: Record<string, PomodoroTimer>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  } catch {
    // Private windows can refuse storage; the timer still runs.
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
  void queryClient.invalidateQueries({ queryKey: ["focus-sessions"] });
}

/** Tracks time on the linked task while a focus phase runs. Failures stay quiet: the timer matters more. */
function trackFocus(timer: PomodoroTimer, action: "start" | "stop") {
  if (!timer.taskId || timer.phase !== "focus") return;
  const call = action === "start" ? startFocus : stopFocus;
  void call(timer.taskId)
    .then(() => refreshTask(timer.taskId!))
    .catch(() => undefined);
}

let ticker: number | null = null;

/** Runs a light ticker only while some timer is counting down. */
function ensureTicker(timers: Record<string, PomodoroTimer>) {
  if (typeof window === "undefined") return;
  const running = Object.values(timers).some((timer) => timer.endsAt !== null);
  if (running && ticker === null) {
    ticker = window.setInterval(() => usePomodoroStore.getState().tick(Date.now()), 500);
  } else if (!running && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
}

export const usePomodoroStore = create<PomodoroStore>((set, get) => {
  const write = (cardId: string, change: (timer: PomodoroTimer) => PomodoroTimer) => {
    const current = get().timers[cardId];
    if (!current) return;
    const timers = { ...get().timers, [cardId]: change(current) };
    set({ timers });
    persist(timers);
    ensureTicker(timers);
  };

  const finish = (timer: PomodoroTimer, completed: boolean, now: number): PomodoroTimer => {
    trackFocus(timer, "stop");
    const next: PomodoroTimer = { ...timer, ...advancePomodoro(timer, timer.settings, completed, todayInZone(timer.timeZone), now) };
    if (completed) {
      if (timer.settings.sound) chime();
      notify(
        timer.phase === "focus" ? "Focus round done" : "Break over",
        timer.phase === "focus" ? `Time for a ${next.phase === "long" ? "long" : "short"} break.` : "Back to focus.",
      );
    }
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
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
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
        return { ...timer, endsAt: null, remaining: null, extra: 0 };
      }),
    skip: (cardId) => write(cardId, (timer) => finish(timer, false, Date.now())),
    setPhase: (cardId, phase) =>
      write(cardId, (timer) => {
        if (timer.phase === phase) return timer;
        if (timer.endsAt !== null) trackFocus(timer, "stop");
        return { ...timer, phase, endsAt: null, remaining: null, extra: 0 };
      }),
    adjust: (cardId, deltaMs) =>
      write(cardId, (timer) => {
        const next = adjustPomodoro(timer, timer.settings, deltaMs, Date.now());
        return next === timer ? timer : { ...timer, ...next };
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
      for (const timer of due) timers[timer.cardId] = finish(timer, true, now);
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
  const next = { ...timers };
  delete next[cardId];
  usePomodoroStore.setState({ timers: next });
  persist(next);
  ensureTicker(next);
}

// A timer that was running before a reload picks up where it left off,
// including a phase that ended while the app was closed.
if (typeof window !== "undefined") {
  ensureTicker(usePomodoroStore.getState().timers);
}
