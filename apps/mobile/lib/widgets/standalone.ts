import { clockEndsAt, clockState, type ClockState, type PomodoroPhase } from "@timely/contract/dashboard";
import { cancelPomodoroNotification, schedulePomodoroNotification } from "../notifications";
import { forgetPomodoro, usePomodoroStore } from "../pomodoroStore";
import { clockChange, type ClockOp } from "./actions";
import { appScheme, widgetPomodoros } from "./data";
import { forgetLocal, localNumber, readLocal, widgetTrees, writeLocal } from "./local";
import {
  CLOCK_LOCAL_LIMITS,
  clockWidgetModel,
  POMODORO_LOCAL_LIMITS,
  pomodoroLocalFrom,
  pomodoroLocalSettings,
  pomodoroWidgetModel,
  type ClockLocal,
  type PomodoroLocal,
  type PomodoroWidget,
  type WidgetModel,
} from "./model";
import { renderCard } from "./render";
import { setWidgetEntry, widgetEntry } from "./storage";
import type { PomodoroAction } from "./run";

/**
 * The Pomodoro and Timer widgets, which belong to no Dashboard card: each
 * keeps its own timer on the phone. Picking a mode or changing a length while
 * nothing runs happens on the phone alone (lib/widgets/local.ts); only Start,
 * Pause, Skip, Reset and Lap come to the app. A pomodoro card widget gets the
 * same tabs and −/+, and saves a changed length to its card when it starts.
 */

export const POMODORO_WIDGET = "TimelyPomodoro";
export const TIMER_WIDGET = "TimelyTimer";

type Size = { width: number; height: number };

const PHASES: PomodoroPhase[] = ["focus", "short", "long"];

/** The pomodoro store's key for a Pomodoro widget's own timer. */
export const widgetPomodoroKey = (widgetId: number) => `widget-${widgetId}`;
const timerNotification = (widgetId: number) => `clock-widget-${widgetId}`;

type PomodoroFile = PomodoroLocal & {
  /** The timer's phase when last drawn: when it moves on (a phase ended), the widget follows. */
  synced?: PomodoroPhase;
  /** The card's lengths when last drawn: lengths changed on the Dashboard replace the widget's. */
  from?: number[];
};

const isPhase = (value: unknown): value is PomodoroPhase => value === "focus" || value === "short" || value === "long";

const lengthsOf = (local: PomodoroLocal) => [local.focus, local.short, local.long];

/** The widget's phase and lengths: what the phone last saved, unless the timer or the card changed since. */
function pomodoroLocal(widgetId: number, base: PomodoroLocal, timerPhase?: PomodoroPhase): PomodoroLocal {
  const saved = readLocal<PomodoroFile>(widgetId)?.state;
  if (!saved) return { ...base, phase: timerPhase ?? base.phase };
  const from = lengthsOf(base);
  const kept = Array.isArray(saved.from) && saved.from.length === 3 && saved.from.every((n, i) => n === from[i]);
  const phase = timerPhase && timerPhase !== saved.synced ? timerPhase : isPhase(saved.phase) ? saved.phase : base.phase;
  if (!kept) return { ...base, phase };
  return {
    phase,
    focus: localNumber(saved.focus, POMODORO_LOCAL_LIMITS.focus, base.focus),
    short: localNumber(saved.short, POMODORO_LOCAL_LIMITS.short, base.short),
    long: localNumber(saved.long, POMODORO_LOCAL_LIMITS.long, base.long),
  };
}

/**
 * Draws a pomodoro widget and leaves the phone a drawing per phase while it
 * waits, so its tabs and −/+ work on the spot.
 */
export function renderPomodoro(widgetId: number, size: Size, parts: Omit<PomodoroWidget, "local">, base: PomodoroLocal) {
  const timer = parts.pomodoros?.find((t) => t.cardId === parts.cardId);
  const local = pomodoroLocal(widgetId, base, timer?.phase);
  const waiting = !timer || !timer.active;
  const modelFor = (each: PomodoroLocal) => pomodoroWidgetModel({ ...parts, local: each });
  const model = modelFor(local);
  const render = renderCard(model, size);
  writeLocal<PomodoroFile>(widgetId, {
    state: { ...local, synced: timer?.phase, from: lengthsOf(base) },
    variantKey: "phase",
    limits: POMODORO_LOCAL_LIMITS,
    variants: waiting
      ? Object.fromEntries(PHASES.map((phase) => [phase, widgetTrees(renderCard(modelFor({ ...local, phase }), size, { local: true }))]))
      : null,
  });
  return { model, render };
}

/**
 * Before a pomodoro button runs: the timer takes the widget's phase and
 * lengths. Returns them, so a card can save a length changed on the widget.
 */
export function preparePomodoro(widgetId: number, cardId: string, settings: Record<string, unknown> | undefined, timeZone?: string): PomodoroLocal {
  const store = usePomodoroStore.getState();
  const local = pomodoroLocal(widgetId, pomodoroLocalFrom(settings), store.timers[cardId]?.phase);
  store.sync(cardId, pomodoroLocalSettings(settings, local), timeZone);
  const timer = usePomodoroStore.getState().timers[cardId];
  if (timer && timer.endsAt === null && timer.remaining === null && timer.phase !== local.phase) store.setPhase(cardId, local.phase);
  return local;
}

/** The Pomodoro widget's own timer. */
export function standalonePomodoro(widgetId: number, size: Size, now = Date.now()) {
  return renderPomodoro(
    widgetId,
    size,
    { cardId: widgetPomodoroKey(widgetId), title: "Pomodoro", uri: `${appScheme()}://`, settings: undefined, now, pomodoros: widgetPomodoros(now) },
    pomodoroLocalFrom(undefined),
  );
}

export function runStandalonePomodoro(widgetId: number, action: PomodoroAction) {
  const key = widgetPomodoroKey(widgetId);
  preparePomodoro(widgetId, key, undefined);
  const store = usePomodoroStore.getState();
  switch (action.kind) {
    case "pomodoro":
      store[action.op](key);
      return;
    case "pomodoroPhase":
      store.setPhase(key, action.phase);
      return;
    case "pomodoroStep": {
      const timer = usePomodoroStore.getState().timers[key];
      // A waiting phase's length is the widget's (a local tap); a running one changes this round.
      if (timer && (timer.endsAt !== null || timer.remaining !== null)) store.adjust(key, action.by * 60_000);
      return;
    }
  }
}

function clockLocal(widgetId: number): ClockLocal {
  const saved = readLocal<ClockLocal>(widgetId)?.state;
  return {
    mode: saved?.mode === "timer" ? "timer" : "stopwatch",
    minutes: localNumber(saved?.minutes, CLOCK_LOCAL_LIMITS.minutes, 10),
  };
}

function savedClock(widgetId: number): ClockState {
  return clockState(widgetEntry(widgetId).clock as Record<string, unknown> | undefined);
}

const idle = (state: ClockState) => state.startedAt === null && state.elapsed === 0 && !state.done;

/** The Timer widget: a stopwatch or a timer that runs on the phone only. */
export function standaloneTimer(widgetId: number, size: Size, now = Date.now()): { model: WidgetModel; render: ReturnType<typeof renderCard> } {
  const local = clockLocal(widgetId);
  const state = savedClock(widgetId);
  const modelFor = (each: ClockLocal) => clockWidgetModel({ cardId: `widget-${widgetId}`, title: "Timer", uri: `${appScheme()}://`, state, now, local: each });
  const model = modelFor(local);
  const render = renderCard(model, size);
  writeLocal<ClockLocal>(widgetId, {
    state: local,
    variantKey: "mode",
    limits: CLOCK_LOCAL_LIMITS,
    variants: idle(state)
      ? Object.fromEntries(
          (["stopwatch", "timer"] as const).map((mode) => [mode, widgetTrees(renderCard(modelFor({ ...local, mode }), size, { local: true }))]),
        )
      : null,
  });
  return { model, render };
}

export async function runStandaloneTimer(widgetId: number, op: ClockOp) {
  const saved = savedClock(widgetId);
  // An idle timer starts as the widget's tabs and −/+ left it.
  const state = idle(saved) ? { ...saved, ...clockLocal(widgetId) } : saved;
  const change = clockChange(state, op, Date.now());
  if (!change) return;
  const next = { ...state, ...change };
  setWidgetEntry(widgetId, { clock: next });
  const endsAt = next.mode === "timer" ? clockEndsAt(next) : null;
  if (endsAt !== null && endsAt > Date.now()) await schedulePomodoroNotification(timerNotification(widgetId), endsAt, "Timer done", `${next.minutes} min timer`).catch(() => undefined);
  else await cancelPomodoroNotification(timerNotification(widgetId)).catch(() => undefined);
}

/** A Pomodoro or Timer widget was removed: its timer and alerts go with it. */
export function forgetStandalone(widgetId: number, widgetName: string) {
  forgetLocal(widgetId);
  if (widgetName === POMODORO_WIDGET) forgetPomodoro(widgetPomodoroKey(widgetId));
  if (widgetName === TIMER_WIDGET) void cancelPomodoroNotification(timerNotification(widgetId)).catch(() => undefined);
}
