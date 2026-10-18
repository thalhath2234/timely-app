"use no memo";
import { getWidgetInfo, requestWidgetUpdate, requestWidgetUpdateById, type WidgetInfo, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { clockState } from "@timely/contract/dashboard";
import { scheduleWidgetRefresh } from "../../modules/timely-android";
import { clockChange, optimisticModel, parseWidgetAction, WIDGET_ACTION, type WidgetAction } from "./actions";
import { cardWidgetModel, todayModel, type WidgetInput, type WidgetModel } from "./model";
import { renderCard, renderQuickAdd, type QuickAddButton } from "./render";
import { appScheme, forgetWidgetLoads, loadCards, loadWidgetInput, signedIn, widgetPomodoros } from "./data";
import { isPomodoroAction, runPomodoro, runWidgetAction, steppedPomodoroSettings } from "./run";
import { allWidgetEntries, forgetWidget, setWidgetEntry, widgetEntry } from "./storage";

/**
 * Draws Timely's home screen widgets. Android asks for a redraw when one is
 * added or resized (headless, through this handler). There is no fixed
 * update period: the app redraws them after changes, the background refresh
 * every 15 minutes or so, and an alarm when a timer ends.
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
function instantModel(entry: Entry, action: WidgetAction, ranLocally: boolean): WidgetModel | null {
  const now = new Date();
  const quick = (card: NonNullable<Entry["card"]>) => instantCard(entry, card);
  if (isPomodoroAction(action)) {
    if (!entry.card) return null;
    if (ranLocally) return quick(entry.card);
    // A waiting phase's new length shows straight away; the card setting saves after.
    const settings = action.kind === "pomodoroStep" ? steppedPomodoroSettings(entry.card, action.by) : null;
    return settings ? quick({ ...entry.card, settings }) : null;
  }
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
  const ranLocally = isPomodoroAction(action) && runPomodoro(action, entry.card, entry.timeZone);
  const instant = instantModel(entry, action, ranLocally);
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
  forgetWidgetLoads();
  if (isPomodoroAction(action)) {
    const { refreshLiveActivity } = require("../live/liveActivity") as typeof import("../live/liveActivity");
    void refreshLiveActivity();
  }
  try {
    renderWidget(await renderWidgetFor(info));
  } catch {
    const cached = widgetEntry(info.widgetId).model;
    if (cached) renderWidget(renderCard(cached, size));
  }
  // Other widgets may show the same task, habit or sheet; they share what
  // this redraw just loaded. This one was just drawn: a third draw only
  // rewrote its image while the launcher read it.
  void refreshAllWidgets(
    WIDGET_NAMES.filter((name) => name !== "TimelyQuickAdd"),
    { fresh: false, skipId: info.widgetId },
  );
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
    case "WIDGET_RESIZED":
      // Redraw at the new size from what the widget last showed, straight away;
      // the fresh load below can take a few seconds on a slow connection.
      if (widgetInfo.widgetName !== "TimelyQuickAdd") {
        const cached = widgetEntry(widgetInfo.widgetId).model;
        if (cached) renderWidget(renderCard(cached, { width: widgetInfo.width, height: widgetInfo.height }));
      }
    // falls through
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
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

/**
 * Redraws every Timely widget on the home screen (the app calls this after
 * changes), except `skipId`. `fresh: false` reuses what was just loaded, when
 * nothing on the server changed since (a pomodoro, which lives on the phone).
 */
export async function refreshAllWidgets(
  names: readonly string[] = WIDGET_NAMES,
  { fresh = true, skipId }: { fresh?: boolean; skipId?: number } = {},
) {
  if (fresh) forgetWidgetLoads();
  await Promise.all(
    names.map(async (widgetName) => {
      const renderWidget = (info: WidgetInfo) => renderWidgetFor({ ...info, widgetName });
      try {
        if (skipId === undefined) return await requestWidgetUpdate({ widgetName, renderWidget });
        const others = (await getWidgetInfo(widgetName)).filter((info) => info.widgetId !== skipId);
        await Promise.all(others.map((info) => requestWidgetUpdateById({ widgetName, widgetId: info.widgetId, renderWidget })));
      } catch {
        // A widget that can't redraw keeps what it last drew.
      }
    }),
  );
}
