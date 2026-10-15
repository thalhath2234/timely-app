import {
  cardTitle,
  clockEndsAt,
  clockState,
  habitLog,
  normalizeDashboard,
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

/** The pomodoro part runs at once, so the widget can redraw from the store before anything else. */
export function runPomodoro(action: Extract<WidgetAction, { kind: "pomodoro" }>, card: DashboardCard | undefined, timeZone?: string) {
  const store = usePomodoroStore.getState();
  // A card started from the widget before the Dashboard ever showed it.
  if (card) store.sync(action.cardId, card.settings, timeZone);
  if (!usePomodoroStore.getState().timers[action.cardId]) return false;
  store[action.op](action.cardId);
  return true;
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
    case "pomodoro": {
      if (runPomodoro(action, context.card, context.timeZone)) break;
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
