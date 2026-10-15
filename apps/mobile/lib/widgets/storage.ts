import { documentTextFile } from "../textFile";
import type { WidgetModel } from "./model";

/**
 * Which Dashboard card each home screen widget shows, and the last thing it
 * drew, so a widget redrawn while offline (or signed out) keeps its content.
 */

type Entry = { cardId?: string; model?: WidgetModel };
type Store = Record<string, Entry>;

const file = documentTextFile("timely-widgets.json");

function load(): Store {
  try {
    const raw = file.read();
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store) {
  try {
    file.write(JSON.stringify(store));
  } catch {
    // The widget still draws; it just picks its card again next time.
  }
}

export function widgetEntry(widgetId: number): Entry {
  return load()[String(widgetId)] ?? {};
}

export function setWidgetEntry(widgetId: number, change: Entry) {
  const store = load();
  store[String(widgetId)] = { ...store[String(widgetId)], ...change };
  save(store);
}

export function forgetWidget(widgetId: number) {
  const store = load();
  delete store[String(widgetId)];
  save(store);
}
