import { cardTitle, type DashboardCard } from "@timely/contract/dashboard";
import { computeSheetCard, setPickCell } from "@timely/contract/dashboardFiles";
import type { Sheet as ContractSheet } from "@timely/contract/sheet";
import { getSheet, updateSheet, type UpdateSheetPayload } from "../api/sheets";
import { forgetLocal, readLocal, widgetTrees, writeLocal } from "./local";
import { cardWidgetModel, counterCell, counterChanged, counterWidgetModel, sheetCounter, type CounterLocal, type WidgetInput, type WidgetModel } from "./model";
import { renderCard } from "./render";
import { setWidgetEntry, widgetEntry } from "./storage";

/**
 * A sheet counter widget counts on the phone: −/+ change the figure without
 * the app or the server (lib/widgets/local.ts), and the count is saved to the
 * cell in one go, when Save is tapped or the next time Timely redraws the
 * widget (opening the app, the background refresh). Taps saved for one cell
 * never land in another: a counter pointed at a new cell starts over.
 */

type Size = { width: number; height: number };

type CounterFile = CounterLocal & { changed: "yes" | "no"; cell: string };

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export const isCounterCard = (card: DashboardCard | undefined) => card?.query?.sheet?.view === "counter";

/** Taps on the phone not yet saved to `cell`. */
function unsaved(widgetId: number, cell: string) {
  const saved = readLocal<CounterFile>(widgetId)?.state;
  if (!saved || saved.cell !== cell || !Number.isFinite(saved.count) || !Number.isFinite(saved.base)) return 0;
  return round(saved.count - saved.base);
}

/**
 * Draws a counter card's widget and leaves the phone a drawing with and
 * without a count to save, so −/+ redraw on the spot. A counter that can't
 * count on the phone (a formula, a percentage) draws as any card does.
 */
export function renderCounter(widgetId: number, size: Size, card: DashboardCard, input: WidgetInput): WidgetModel {
  const counter = card.query?.sheet ? sheetCounter(card.query.sheet, input, cardTitle(card), card.id) : null;
  if (!counter) {
    forgetLocal(widgetId);
    setWidgetEntry(widgetId, { counter: undefined });
    return cardWidgetModel(card, input);
  }
  const local = { count: round(counter.value + unsaved(widgetId, counter.cell)), base: counter.value };
  const modelFor = (changed: boolean) => counterWidgetModel({ ...counter.widget, local }, changed);
  writeLocal<CounterFile>(widgetId, {
    state: { ...local, changed: counterChanged(local) ? "yes" : "no", cell: counter.cell },
    variantKey: "changed",
    limits: {},
    differs: { changed: ["count", "base"] },
    variants: {
      no: widgetTrees(renderCard(modelFor(false), size, { local: true })),
      yes: widgetTrees(renderCard(modelFor(true), size, { local: true })),
    },
  });
  setWidgetEntry(widgetId, { counter: { widget: counter.widget, cell: counter.cell } });
  return modelFor(counterChanged(local));
}

/** Offline: the counter as the phone last counted it, from what it last drew. */
export function offlineCounter(widgetId: number): WidgetModel | null {
  const kept = widgetEntry(widgetId).counter;
  const saved = readLocal<CounterFile>(widgetId)?.state;
  if (!kept || !saved || saved.cell !== kept.cell) return null;
  return counterWidgetModel({ ...kept.widget, local: { count: saved.count, base: saved.base } });
}

const saving = new Map<number, Promise<boolean>>();

/**
 * Adds the taps made on the phone to the counter's cell. True when it saved.
 * One save per widget at a time, so two redraws never add the same taps twice.
 */
export function saveCounter(widgetId: number, card: DashboardCard): Promise<boolean> {
  const before = saving.get(widgetId) ?? Promise.resolve(false);
  const next = before.catch(() => false).then(() => save(widgetId, card));
  saving.set(widgetId, next);
  return next;
}

async function save(widgetId: number, card: DashboardCard) {
  const pick = card.query?.sheet;
  const taken = readLocal<CounterFile>(widgetId);
  if (!pick || pick.view !== "counter" || !taken) return false;
  const delta = round(taken.state.count - taken.state.base);
  if (!delta) return false;
  const sheet = (await getSheet(pick.sheetId)) as unknown as ContractSheet;
  const result = computeSheetCard(sheet, pick);
  if (result.kind !== "counter" || !result.cell || result.cell.formula || counterCell(pick, result.cell) !== taken.state.cell) return false;
  // Added to what the cell holds now, so a change made elsewhere meanwhile stays.
  const total = round(result.value + delta);
  const change = setPickCell(sheet, pick.tabId, result.cell.rowId, result.cell.colId, String(total));
  if (!change) return false;
  await updateSheet(pick.sheetId, change.payload as unknown as UpdateSheetPayload);
  // Taps that landed while this saved wait for the next save.
  const now = readLocal<CounterFile>(widgetId) ?? taken;
  const extra = round(now.state.count - taken.state.count);
  const state = { ...now.state, base: total, count: round(total + extra) };
  writeLocal<CounterFile>(widgetId, { ...now, state: { ...state, changed: counterChanged(state) ? "yes" : "no" } });
  return true;
}
