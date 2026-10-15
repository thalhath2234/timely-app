"use no memo";
import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { clockState } from "@timely/contract/dashboard";
import { scheduleWidgetRefresh } from "../../modules/timely-android";
import { clockChange, optimisticModel, parseWidgetAction, WIDGET_ACTION, type WidgetAction } from "./actions";
import { cardWidgetModel, todayModel, type WidgetInput, type WidgetModel } from "./model";
import { renderCard, renderQuickAdd, type QuickAddButton } from "./render";
import { appScheme, loadCards, loadWidgetInput, signedIn, widgetPomodoros } from "./data";
import { runPomodoro, runWidgetAction } from "./run";
import { allWidgetEntries, forgetWidget, setWidgetEntry, widgetEntry } from "./storage";

/**
 * Draws Timely's home screen widgets. Android asks for a redraw when one is
 * added, resized or every 30 minutes (headless, through this handler); the
 * app also redraws them after changes (lib/widgets/sync.ts).
 */

export const WIDGET_NAMES = ["TimelyCard", "TimelyToday", "TimelyQuickAdd"] as const;

export function quickAddButtons(scheme = appScheme()): QuickAddButton[] {
  return [
    { label: "Task", glyph: "task", uri: `${scheme}://shortcut/new-task` },
    { label: "Capture", glyph: "capture", uri: `${scheme}://shortcut/capture` },
    { label: "Ask", glyph: "ask", uri: `${scheme}://shortcut/ask` },
    { label: "Search", glyph: "search", uri: `${scheme}://shortcut/search` },
  ];
}

function signedOut(title: string): WidgetModel {
  return { title, uri: `${appScheme()}://`, empty: "Open Timely and sign in to see this." };
}

/** The model for one widget, falling back to what it last drew. */
export async function widgetModel(info: WidgetInfo, cardId?: string): Promise<WidgetModel> {
  const entry = widgetEntry(info.widgetId);
  const id = cardId ?? entry.cardId;
  let model: WidgetModel | null = null;
  if (info.widgetName === "TimelyToday") {
    const input = await loadWidgetInput([], { today: true });
    model = input ? todayModel(input) : null;
    if (!model) return entry.model ?? signedOut("Today");
  } else {
    const board = await loadCards();
    if (!board) {
      // Offline: a pomodoro still runs on the phone, so draw it from there.
      if (entry.card?.type === "pomodoro" && (await signedIn())) return instantCard(entry, entry.card);
      return entry.model ?? signedOut("Timely");
    }
    const card = board.cards.find((c) => c.id === id);
    if (!card) {
      return {
        title: "Timely",
        uri: `${appScheme()}://dashboard`,
        empty: id ? "This card is no longer on your Dashboard. Hold the widget to pick another." : "Hold the widget to pick a card.",
      };
    }
    const input = await loadWidgetInput([card]);
    if (!input) return entry.model ?? signedOut("Timely");
    model = cardWidgetModel(card, input);
    setWidgetEntry(info.widgetId, { model, card, timeZone: input.timeZone, ...(cardId ? { cardId } : {}) });
    scheduleTimerRedraw();
    return model;
  }
  setWidgetEntry(info.widgetId, { model, ...(cardId ? { cardId } : {}) });
  return model;
}

/**
 * The launcher ticks a widget's clock by itself, but only the app can move a
 * timer on when it ends: wake the widgets just after the earliest end.
 */
export function scheduleTimerRedraw(now = Date.now()) {
  const ends = Object.values(allWidgetEntries())
    .map((entry) => entry.model?.timer)
    .filter((timer) => timer?.countDown && timer.running && timer.base > now)
    .map((timer) => timer!.base);
  scheduleWidgetRefresh(ends.length ? Math.min(...ends) + 1_000 : 0);
}

const NO_DATA: WidgetInput["data"] = { tasks: [], projects: [], workspaces: [], docs: [], sheets: [], inbox: [], reminders: [], events: [] };

type Entry = ReturnType<typeof widgetEntry>;

/** A card drawn from what's on the phone only (no network). */
function instantCard(entry: Entry, card: NonNullable<Entry["card"]>) {
  const now = new Date();
  return cardWidgetModel(card, { now, data: NO_DATA, scheme: appScheme(), timeZone: entry.timeZone, pomodoros: widgetPomodoros(now.getTime()) });
}

/** What the widget shows the moment a button is tapped, before the save comes back. */
function instantModel(entry: Entry, action: WidgetAction): WidgetModel | null {
  const now = new Date();
  const quick = (card: NonNullable<Entry["card"]>) => instantCard(entry, card);
  if (action.kind === "pomodoro") return entry.card ? quick(entry.card) : null;
  if (action.kind === "clock") {
    if (!entry.card) return null;
    const change = clockChange(clockState(entry.card.settings), action.op, now.getTime());
    return change ? quick({ ...entry.card, settings: { ...entry.card.settings, ...change } }) : null;
  }
  return entry.model ? optimisticModel(entry.model, action) : null;
}

async function handleAction(info: WidgetInfo, data: Record<string, unknown> | undefined, renderWidget: WidgetTaskHandlerProps["renderWidget"]) {
  const action = parseWidgetAction(data);
  if (!action) return;
  const size = { width: info.width, height: info.height };
  const entry = widgetEntry(info.widgetId);
  // The pomodoro lives on the phone, so it changes before the redraw.
  const ranLocally = action.kind === "pomodoro" && runPomodoro(action, entry.card, entry.timeZone);
  const instant = instantModel(entry, action);
  if (instant && instant !== entry.model) {
    renderWidget(renderCard(instant, size));
    setWidgetEntry(info.widgetId, { model: instant });
    scheduleTimerRedraw();
  }
  try {
    if (!ranLocally) await runWidgetAction(action, { card: entry.card, timeZone: entry.timeZone });
  } catch {
    // Offline or refused: put back what was there, then redraw from the server.
    if (entry.model) setWidgetEntry(info.widgetId, { model: entry.model });
  }
  if (action.kind === "pomodoro") {
    const { refreshLiveActivity } = require("../live/liveActivity") as typeof import("../live/liveActivity");
    void refreshLiveActivity();
  }
  try {
    renderWidget(await renderWidgetFor(info));
  } catch {
    const cached = widgetEntry(info.widgetId).model;
    if (cached) renderWidget(renderCard(cached, size));
  }
  // Other widgets may show the same task, habit or sheet.
  void refreshAllWidgets(WIDGET_NAMES.filter((name) => name !== "TimelyQuickAdd"));
}

export async function renderWidgetFor(info: WidgetInfo, cardId?: string) {
  const size = { width: info.width, height: info.height };
  if (info.widgetName === "TimelyQuickAdd") return renderQuickAdd(quickAddButtons(), size);
  return renderCard(await widgetModel(info, cardId), size);
}

export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget, clickAction, clickActionData }: WidgetTaskHandlerProps) {
  switch (widgetAction) {
    case "WIDGET_DELETED":
      forgetWidget(widgetInfo.widgetId);
      return;
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      try {
        renderWidget(await renderWidgetFor(widgetInfo));
      } catch {
        const cached = widgetEntry(widgetInfo.widgetId).model;
        if (cached) renderWidget(renderCard(cached, { width: widgetInfo.width, height: widgetInfo.height }));
      }
      return;
    case "WIDGET_CLICK":
      // OPEN_URI taps open the app without us; buttons that work in place come here.
      if (clickAction === WIDGET_ACTION) await handleAction(widgetInfo, clickActionData, renderWidget);
      return;
    default:
      return;
  }
}

/** Redraws every Timely widget on the home screen (the app calls this after changes). */
export async function refreshAllWidgets(names: readonly string[] = WIDGET_NAMES) {
  await Promise.all(
    names.map((widgetName) =>
      requestWidgetUpdate({ widgetName, renderWidget: (info) => renderWidgetFor({ ...info, widgetName }) }).catch(() => undefined),
    ),
  );
}
