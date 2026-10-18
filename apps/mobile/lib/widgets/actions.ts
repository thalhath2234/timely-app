/**
 * What a tap on a widget can do without opening the app: run a pomodoro or
 * a stopwatch, tick a habit, a task or a doc checkbox, or step a sheet
 * counter. The renderer sends these as clickActionData; the widget task
 * handler runs them (lib/widgets/run.ts) and redraws. Pure, so
 * `make test-mobile-widgets` checks it under Node.
 */
import { CLOCK_MAX_LAPS, clockElapsed, clockRemaining, type ClockState, type PomodoroPhase } from "@timely/contract/dashboard";
import type { WidgetModel, WidgetRow } from "./model";

export const WIDGET_ACTION = "TIMELY_ACTION";

/**
 * A tap the phone handles without the app: it changes the widget's own small
 * state (a mode, a length) and redraws from trees the app left for it
 * (patches/react-native-android-widget, RNWidgetLocal; lib/widgets/local.ts).
 */
export const WIDGET_LOCAL = "TIMELY_LOCAL";

/** Sets `set` to `value`, or moves the number `step` by `by` (within the widget's limits). */
export type LocalTap = { set: string; value: string } | { step: string; by: number };

/** What a tab or −/+ does: an action for the app, or a change the phone makes by itself. */
export type WidgetTap = WidgetAction | LocalTap;

export function isLocalTap(tap: WidgetTap): tap is LocalTap {
  return !("kind" in tap);
}

export type PomodoroOp = "start" | "pause" | "skip" | "reset";
export type ClockOp = "start" | "pause" | "reset" | "lap";

export type WidgetAction =
  | { kind: "pomodoro"; cardId: string; op: PomodoroOp }
  /** Switches the pomodoro to Focus, Short break or Long break, as its tabs do on the Dashboard. */
  | { kind: "pomodoroPhase"; cardId: string; phase: PomodoroPhase }
  /** Minutes on or off: the phase's length before it starts, this round only once it runs. */
  | { kind: "pomodoroStep"; cardId: string; by: number }
  | { kind: "clock"; cardId: string; op: ClockOp }
  | { kind: "habit"; cardId: string; habitId: string }
  /** `done` is the state the tap asks for; `originalStart` marks one occurrence of a repeating task. */
  | { kind: "task"; taskId: string; done: boolean; originalStart?: string }
  | { kind: "counter"; cardId: string; by: number }
  | { kind: "docCheck"; cardId: string; index: number; checked: boolean };

/** Reads an action back from the flat clickActionData Android hands the handler. */
export function parseWidgetAction(data: Record<string, unknown> | undefined | null): WidgetAction | null {
  if (!data) return null;
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  const num = (key: string) => (typeof data[key] === "number" && Number.isFinite(data[key]) ? (data[key] as number) : null);
  const bool = (key: string) => data[key] === true || data[key] === "true";
  const cardId = str("cardId");
  switch (str("kind")) {
    case "pomodoro": {
      const op = str("op");
      return cardId && (op === "start" || op === "pause" || op === "skip" || op === "reset") ? { kind: "pomodoro", cardId, op } : null;
    }
    case "pomodoroPhase": {
      const phase = str("phase");
      return cardId && (phase === "focus" || phase === "short" || phase === "long") ? { kind: "pomodoroPhase", cardId, phase } : null;
    }
    case "pomodoroStep": {
      const by = num("by");
      return cardId && by ? { kind: "pomodoroStep", cardId, by } : null;
    }
    case "clock": {
      const op = str("op");
      return cardId && (op === "start" || op === "pause" || op === "reset" || op === "lap") ? { kind: "clock", cardId, op } : null;
    }
    case "habit":
      return cardId && str("habitId") ? { kind: "habit", cardId, habitId: str("habitId") } : null;
    case "task":
      return str("taskId")
        ? { kind: "task", taskId: str("taskId"), done: bool("done"), ...(str("originalStart") ? { originalStart: str("originalStart") } : {}) }
        : null;
    case "counter": {
      const by = num("by");
      return cardId && by ? { kind: "counter", cardId, by } : null;
    }
    case "docCheck": {
      const index = num("index");
      return cardId && index !== null ? { kind: "docCheck", cardId, index, checked: bool("checked") } : null;
    }
    default:
      return null;
  }
}

/** The change a stopwatch or timer button makes to the card's settings, or null when it does nothing. */
export function clockChange(state: ClockState, op: ClockOp, now: number): Partial<ClockState> | null {
  const running = state.startedAt !== null;
  switch (op) {
    case "start": {
      // A timer that ran out starts over from its full length.
      const fresh = state.mode === "timer" && (state.done || clockRemaining(state, now) <= 0);
      if (running && !fresh) return null;
      return fresh ? { startedAt: now, elapsed: 0, done: false } : { startedAt: now, done: false };
    }
    case "pause":
      return running ? { elapsed: clockElapsed(state, now), startedAt: null } : null;
    case "reset":
      return { startedAt: null, elapsed: 0, laps: [], done: false };
    case "lap":
      return running && state.mode === "stopwatch" ? { laps: [...state.laps, clockElapsed(state, now)].slice(-CLOCK_MAX_LAPS) } : null;
  }
}

function sameAction(a: WidgetAction | undefined, b: WidgetAction) {
  if (!a || a.kind !== b.kind) return false;
  switch (b.kind) {
    case "habit":
      return a.kind === "habit" && a.habitId === b.habitId && a.cardId === b.cardId;
    case "task":
      return a.kind === "task" && a.taskId === b.taskId && a.originalStart === b.originalStart;
    case "docCheck":
      return a.kind === "docCheck" && a.index === b.index && a.cardId === b.cardId;
    default:
      return false;
  }
}

function flipRow(row: WidgetRow): WidgetRow {
  const done = !row.done;
  const toggle = row.toggle;
  if (!toggle) return { ...row, done };
  const next: WidgetRow["toggle"] =
    toggle.kind === "task" ? { ...toggle, done: !done } : toggle.kind === "docCheck" ? { ...toggle, checked: !done } : toggle;
  return { ...row, done, toggle: next };
}

/**
 * The widget as it will look once a tick lands, drawn straight away so the
 * tap feels instant; the real data replaces it after the save.
 */
export function optimisticModel(model: WidgetModel, action: WidgetAction): WidgetModel {
  if (action.kind === "counter") {
    const current = Number((model.value ?? "").replace(/[^0-9.-]/g, ""));
    if (!model.value || !Number.isFinite(current)) return model;
    return { ...model, value: String(Math.round((current + action.by) * 1e6) / 1e6) };
  }
  if (action.kind !== "habit" && action.kind !== "task" && action.kind !== "docCheck") return model;
  let changed = false;
  const rows = (model.rows ?? []).map((row) => {
    if (!sameAction(row.toggle, action)) return row;
    changed = true;
    return flipRow(row);
  });
  if (!changed) return model;
  // "2/3" style figures count the ticked rows.
  const tally = /^(\d+)\/(\d+)$/.exec(model.value ?? "");
  const delta = rows.filter((row) => row.done).length - (model.rows ?? []).filter((row) => row.done).length;
  const value = tally ? `${Math.max(0, Number(tally[1]) + delta)}/${tally[2]}` : model.value;
  return { ...model, rows, value };
}
