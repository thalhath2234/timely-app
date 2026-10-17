import {
  POMODORO_PHASE_MAX,
  POMODORO_PHASE_SETTING,
  cardTitle,
  clockEndsAt,
  clockState,
  habitLog,
  normalizeDashboard,
  pomodoroSettings,
  toggleHabit,
  type DashboardCard,
} from "@timely/contract/dashboard";
import { computeSheetCard, setPickCell, toggleDocCheck } from "@timely/contract/dashboardFiles";
import type { DocContent } from "@timely/contract/documents";
import type { Sheet as ContractSheet } from "@timely/contract/sheet";
import { todayInZone } from "@timely/contract/workStatus";
import { getDoc, updateDoc } from "../api/docs";
import { getSheet, updateSheet, type UpdateSheetPayload } from "../api/sheets";
import { editTaskOccurrence, updateTask } from "../api/tasks";
import { getConfig, updateConfig } from "../api/workspaces";
import { cancelPomodoroNotification, schedulePomodoroNotification } from "../notifications";
import { usePomodoroStore } from "../pomodoroStore";
import { clockChange, type WidgetAction } from "./actions";

/**
 * Runs a widget button on the home screen: the pomodoro on the device, the
 * rest against the API. Taps run one at a time, so two quick taps on a
 * counter add two, not one.
 */

export type ActionContext = { card?: DashboardCard; timeZone?: string };

let queue: Promise<unknown> = Promise.resolve();

export function runWidgetAction(action: WidgetAction, context: ActionContext): Promise<void> {
  const next = queue.then(() => run(action, context));
  queue = next.catch(() => undefined);
  return next;
}

export type PomodoroAction = Extract<WidgetAction, { kind: "pomodoro" | "pomodoroPhase" | "pomodoroStep" }>;

export function isPomodoroAction(action: WidgetAction): action is PomodoroAction {
  return action.kind === "pomodoro" || action.kind === "pomodoroPhase" || action.kind === "pomodoroStep";
}

/** A pomodoro that hasn't started its phase: −/+ change that phase's length on the card. */
function waiting(cardId: string) {
  const timer = usePomodoroStore.getState().timers[cardId];
  return !timer || (timer.endsAt === null && timer.remaining === null);
}

/**
 * The pomodoro part runs at once, so the widget can redraw from the store
 * before anything else. False when it needs the server: a phase's length is a
 * card setting.
 */
export function runPomodoro(action: PomodoroAction, card: DashboardCard | undefined, timeZone?: string) {
  const store = usePomodoroStore.getState();
  // A card started from the widget before the Dashboard ever showed it.
  if (card) store.sync(action.cardId, card.settings, timeZone);
  if (!usePomodoroStore.getState().timers[action.cardId]) return false;
  switch (action.kind) {
    case "pomodoro":
      store[action.op](action.cardId);
      return true;
    case "pomodoroPhase":
      store.setPhase(action.cardId, action.phase);
      return true;
    case "pomodoroStep":
      if (waiting(action.cardId)) return false;
      store.adjust(action.cardId, action.by * 60_000);
      return true;
  }
}

/** The card's settings with the waiting phase made `by` minutes longer or shorter, or null at a limit. */
export function steppedPomodoroSettings(card: DashboardCard, by: number) {
  const phase = usePomodoroStore.getState().timers[card.id]?.phase ?? "focus";
  const key = POMODORO_PHASE_SETTING[phase];
  const current = pomodoroSettings(card.settings)[key];
  const next = Math.min(POMODORO_PHASE_MAX[phase], Math.max(1, current + by));
  return next === current ? null : { ...card.settings, [key]: next };
}

async function boardCard(cardId: string) {
  const config = await getConfig();
  const layout = normalizeDashboard(config.reportDashboard);
  const card = layout.cards.find((entry) => entry.id === cardId);
  if (!card) throw new Error("This card is no longer on the Dashboard");
  return { config, layout, card };
}

/** Changes one card's settings on the server, from the latest copy of the board. */
async function saveSettings(cardId: string, change: (card: DashboardCard, timeZone: string | undefined) => Record<string, unknown> | null) {
  const { config, layout, card } = await boardCard(cardId);
  const patch = change(card, config.workingHours?.timezone || undefined);
  if (!patch) return null;
  const next = { ...card, settings: { ...card.settings, ...patch } };
  await updateConfig({ reportDashboard: { ...layout, cards: layout.cards.map((entry) => (entry.id === cardId ? next : entry)) } });
  return next;
}

async function run(action: WidgetAction, context: ActionContext) {
  switch (action.kind) {
    case "pomodoro":
    case "pomodoroPhase":
    case "pomodoroStep": {
      if (runPomodoro(action, context.card, context.timeZone)) break;
      if (action.kind === "pomodoroStep" && waiting(action.cardId)) {
        const next = await saveSettings(action.cardId, (card) => steppedPomodoroSettings(card, action.by));
        if (next) usePomodoroStore.getState().sync(action.cardId, next.settings, context.timeZone);
        break;
      }
      const { card, config } = await boardCard(action.cardId);
      runPomodoro(action, card, config.workingHours?.timezone || undefined);
      break;
    }
    case "clock": {
      const next = await saveSettings(action.cardId, (card) => clockChange(clockState(card.settings), action.op, Date.now()));
      if (!next) break;
      // The end of a running timer rings, as it does from the Dashboard.
      const state = clockState(next.settings);
      const endsAt = clockEndsAt(state);
      const notifyId = `clock-${action.cardId}`;
      if (endsAt !== null && endsAt > Date.now()) await schedulePomodoroNotification(notifyId, endsAt, "Timer done", cardTitle(next)).catch(() => undefined);
      else await cancelPomodoroNotification(notifyId).catch(() => undefined);
      break;
    }
    case "habit":
      await saveSettings(action.cardId, (card, timeZone) => {
        const day = todayInZone(timeZone);
        return { log: toggleHabit(habitLog(card.settings), action.habitId, day, day) };
      });
      break;
    case "task":
      if (action.originalStart) {
        // One day of a repeating task; undoing it stays in the app.
        if (action.done) await editTaskOccurrence(action.taskId, { originalStart: action.originalStart, action: "complete" });
      } else await updateTask(action.taskId, { completedAt: action.done ? new Date().toISOString() : null });
      break;
    case "counter": {
      const pick = (context.card ?? (await boardCard(action.cardId)).card).query?.sheet;
      if (!pick) break;
      const sheet = (await getSheet(pick.sheetId)) as unknown as ContractSheet;
      const result = computeSheetCard(sheet, pick);
      if (result.kind !== "counter" || !result.cell || result.cell.formula) break;
      const value = Math.round((result.value + action.by) * 1e6) / 1e6;
      const change = setPickCell(sheet, pick.tabId, result.cell.rowId, result.cell.colId, String(value));
      if (change) await updateSheet(pick.sheetId, change.payload as unknown as UpdateSheetPayload);
      break;
    }
    case "docCheck": {
      const pick = (context.card ?? (await boardCard(action.cardId)).card).query?.doc;
      if (!pick) break;
      const doc = await getDoc(pick.docId);
      const content = doc.content as DocContent | undefined;
      if (!content) break;
      await updateDoc(pick.docId, { content: toggleDocCheck(content, action.index, action.checked) });
      break;
    }
  }
}
