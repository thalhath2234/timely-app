import type { ReactElement } from "react";
import { File, Paths } from "expo-file-system";
import { documentTextFile } from "../textFile";

/**
 * What a widget leaves for the phone so its tabs and −/+ work without the app
 * (RNWidgetLocal in patches/react-native-android-widget): its own small state,
 * the tree it drew for each variant of that state and the limits of each
 * number. A local tap changes the state in this file and redraws from the
 * trees; Start and the other action buttons come to the app, which reads the
 * state back from here. `variants: null` while a timer runs: every tap is the
 * app's again.
 */

type Trees = { light: unknown; dark: unknown };

export type LocalFile<S> = {
  state: S;
  /** The state key that picks the variant to draw. */
  variantKey: string;
  limits: Record<string, [number, number]>;
  /** State keys the phone sets to "yes" or "no" after each tap: whether the two numbers named differ. */
  differs?: Record<string, [string, string]>;
  variants: Record<string, Trees> | null;
};

const name = (widgetId: number) => `timely-widget-local-${widgetId}.json`;

const { buildWidgetTree } = require("react-native-android-widget/lib/commonjs/api/build-widget-tree") as {
  buildWidgetTree: (tree: ReactElement) => unknown;
};

export function readLocal<S>(widgetId: number): LocalFile<S> | null {
  try {
    const text = documentTextFile(name(widgetId)).read();
    const parsed = text ? (JSON.parse(text) as LocalFile<S>) : null;
    return parsed && typeof parsed.state === "object" && parsed.state ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocal<S>(widgetId: number, doc: LocalFile<S>) {
  try {
    documentTextFile(name(widgetId)).write(JSON.stringify(doc));
  } catch {
    // The tabs then wait for the app, as before.
  }
}

export function forgetLocal(widgetId: number) {
  try {
    const file = new File(Paths.document, name(widgetId));
    if (file.exists) file.delete();
  } catch {
    // Nothing left to draw from it anyway.
  }
}

/** A render (light and dark) as the trees the phone draws from. */
export function widgetTrees(render: { light: ReactElement; dark: ReactElement }): Trees {
  return { light: buildWidgetTree(render.light), dark: buildWidgetTree(render.dark) };
}

/** A number from the file (the phone writes them as decimals) within its limits. */
export function localNumber(value: unknown, [min, max]: [number, number], fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}
