import {
  cleanWatchInput,
  defaultMinutes,
  draftErrors,
  floorMinutes,
  readingKind,
  type BotInput,
  type Rule,
  type RuleKind,
  type WatchInput,
  type WatchKind,
} from "@timely/contract/bots";

/**
 * The rules a watch gets when saved with none, as the API's DefaultRules
 * and the web editor: a page alerts on any change, a feed on new posts, a
 * shop price on a 5% drop and a market price on a 5% move either way.
 */
export function defaultRules(w: Pick<WatchInput, "kind" | "read">): Rule[] {
  switch (readingKind(w)) {
    case "feed":
      return [{ kind: "new_item" }];
    case "price":
      return [{ kind: "move_pct", percent: 5, direction: w.kind === "page" ? "down" : "any" }];
  }
  return [{ kind: "any_change" }];
}

/** A rule of `kind` with a starting value, so it reads well before it is filled in. */
export function newRule(kind: RuleKind, w: Pick<WatchInput, "kind">): Rule {
  switch (kind) {
    case "below":
    case "above":
      return { kind, stepPercent: 5, resetPercent: 0.5 };
    case "move_pct":
      return { kind, percent: 5, direction: w.kind === "page" ? "down" : "any" };
    case "words_appear":
    case "words_disappear":
      return { kind, words: [] };
  }
  return { kind };
}

/** A fresh watch of `kind`, with the rules a new watch of that kind gets. */
export function blankWatch(kind: WatchKind): WatchInput {
  const w: WatchInput =
    kind === "price" ? { kind, source: "stock", symbol: "" } : kind === "feed" ? { kind, url: "" } : { kind, url: "", read: "text" };
  return { ...w, rules: defaultRules(w) };
}

/** A watch's fields changed: keep its rules when it still gives the same kind of reading. */
export function reshape(prev: WatchInput, next: WatchInput): WatchInput {
  return readingKind(prev) === readingKind(next) ? next : { ...next, rules: defaultRules(next) };
}

export const isStock = (source: string | undefined) => !source || source === "stock" || source === "finnhub";

/** The watch's own problems, in the words Create uses (the bot's name and rules left out). */
export function watchErrors(w: WatchInput, hasKey?: (source: string) => boolean): string[] {
  return draftErrors({ name: "x", description: "", intervalMinutes: 0, watches: [{ ...w, rules: [] }] }, hasKey);
}

/** A rule's own problems, in the words Create uses. */
export function ruleErrors(rule: Rule, watch: WatchInput): string[] {
  return draftErrors({ name: "x", description: "", intervalMinutes: 0, watches: [{ ...cleanWatchInput(watch), rules: [rule] }] }).filter(
    (m) => /price to watch for|percent it should move|words to look for|does not fit/.test(m),
  );
}

/** A watch list with an interval that still fits it (raised to the new floor when a watch needs it). */
export function withWatches(draft: BotInput, watches: WatchInput[]): BotInput {
  const every = draft.intervalMinutes;
  const intervalMinutes = every && every < floorMinutes(watches) ? defaultMinutes(watches) : every;
  return { ...draft, watches, intervalMinutes };
}

/** "25000" / "0.5": a number as typed into a field, without grouping. */
export function numberText(n: number | undefined): string {
  return n == null ? "" : String(Number(n.toFixed(8)));
}

/** A typed amount ("25,000", "₹25000", "0,5" is not taken) as a number, or undefined. */
export function parseAmount(text: string): number | undefined {
  const clean = text.replace(/[^\d.]/g, "");
  if (!clean) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}
