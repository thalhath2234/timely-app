"use no memo";
import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { cardWidgetModel, todayModel, type WidgetModel } from "./model";
import { renderCard, renderQuickAdd, type QuickAddButton } from "./render";
import { appScheme, loadCards, loadWidgetInput } from "./data";
import { forgetWidget, setWidgetEntry, widgetEntry } from "./storage";

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
    if (!board) return entry.model ?? signedOut("Timely");
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
  }
  setWidgetEntry(info.widgetId, { model, ...(cardId ? { cardId } : {}) });
  return model;
}

export async function renderWidgetFor(info: WidgetInfo, cardId?: string) {
  const size = { width: info.width, height: info.height };
  if (info.widgetName === "TimelyQuickAdd") return renderQuickAdd(quickAddButtons(), size);
  return renderCard(await widgetModel(info, cardId), size);
}

export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
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
    default:
      // Every tap is an OPEN_URI link, which Android handles without us.
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
