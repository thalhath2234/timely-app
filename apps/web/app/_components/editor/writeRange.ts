import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/core";
import { isWriteList, type WriteBelow, type WriteFit, type WriteSpot } from "@timely/contract/helpMeWrite";

/**
 * Help me write on a selection: what is sent, and where the answer goes.
 * Replace only ever puts the answer over exactly what was sent, so it never
 * deletes text the AI did not see, never splits a line, list item or table,
 * and never nests a list in a line or a table in a table cell. The phone's
 * editor runs the same steps (WRITE_RANGE_JS in apps/mobile/lib/helpMeWriteRange.ts);
 * scripts/help-me-write-range.test.mjs runs both on the same docs.
 */

/** What is rewritten: the range, its plain text (shown, and compared before
 * the answer goes in), the same part as a doc for the API to read as
 * Markdown, and where it sits. */
export type Captured = { from: number; to: number; text: string; doc?: JSONContent; spot?: WriteSpot };

/** The answer as writtenContent gives it. */
export type Written = { blocks: JSONContent[]; inline: JSONContent[] | null; items: JSONContent[] | null };

/** A mention reads as its @label and a line break as one; textBetween skips
 * both on its own. */
const leafText = (node: PMNode) =>
  node.type.name === "mention" ? `@${String(node.attrs.label ?? "")}` : node.type.name === "hardBreak" ? "\n" : "";

export const plainBetween = (doc: PMNode, from: number, to: number) => doc.textBetween(from, to, "\n", leafText).trim();

/** Nodes a selection across blocks never stops inside: it takes them whole. */
const TAKEN_WHOLE = new Set(["table", "tableRow", "listItem", "taskItem", "columns", "details"]);
const isCell = (name: string) => name === "tableCell" || name === "tableHeader";

/** The end of the line before `pos` (a position just before a block), or -1. */
function lineEndBefore(doc: PMNode, pos: number) {
  for (;;) {
    const $pos = doc.resolve(pos);
    const before = $pos.nodeBefore;
    if (!before) {
      if ($pos.depth === 0) return -1;
      pos = $pos.before();
    } else if (before.isTextblock) return pos - 1;
    else if (before.isLeaf) return -1;
    else pos -= 1;
  }
}

/** The start of the line after `pos` (a position just after a block), or -1. */
function lineStartAfter(doc: PMNode, pos: number) {
  for (;;) {
    const $pos = doc.resolve(pos);
    const after = $pos.nodeAfter;
    if (!after) {
      if ($pos.depth === 0) return -1;
      pos = $pos.after();
    } else if (after.isTextblock) return pos + 1;
    else if (after.isLeaf) return -1;
    else pos += 1;
  }
}

/**
 * The selection as Help me write rewrites it. Words within one line stay as
 * they are; a selection across lines grows to the whole blocks or list items
 * it touches (across table cells, to the whole table), so what is sent is
 * exactly what Replace takes the place of.
 */
export function captureSelection(state: EditorState): Captured {
  const { doc } = state;
  let { from, to } = state.selection;
  if (from === to) return { from, to, text: "" };
  // Ending at the very start of a line, or starting at the very end of one,
  // does not take that line.
  const $end = doc.resolve(to);
  if ($end.depth > 0 && $end.parent.isTextblock && $end.parentOffset === 0) {
    const back = lineEndBefore(doc, $end.before());
    if (back > from) to = back;
  }
  const $start = doc.resolve(from);
  if ($start.depth > 0 && $start.parent.isTextblock && $start.parentOffset === $start.parent.content.size) {
    const ahead = lineStartAfter(doc, $start.after());
    if (ahead >= 0 && ahead < to) from = ahead;
  }
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const line = $from.parent;
    const holder = $from.node($from.depth - 1);
    const whole = from <= $from.start() && to >= $from.end();
    const inItem = holder.type.name === "listItem" || holder.type.name === "taskItem";
    const list = inItem ? $from.node($from.depth - 2).type.name : null;
    const spot: WriteSpot = inItem
      ? { kind: "line", whole, in: "item", list: isWriteList(list) ? list : null, alone: holder.childCount === 1 }
      : { kind: "line", whole, in: isCell(holder.type.name) ? "cell" : "block" };
    const words = line.content.cut($from.parentOffset, $to.parentOffset);
    return {
      from,
      to,
      text: plainBetween(doc, from, to),
      spot,
      // Code goes as it is, not as Markdown.
      doc: line.type.spec.code ? undefined : { type: "doc", content: [{ type: "paragraph", content: words.toJSON() ?? [] }] },
    };
  }
  const range = $from.blockRange($to, (node) => !TAKEN_WHOLE.has(node.type.name));
  if (!range) return { from, to, text: "" };
  let first = range.startIndex;
  // The doc's properties are not rewritten.
  if (range.depth === 0 && first === 0 && range.parent.firstChild?.type.name === "frontmatter") first = 1;
  if (first >= range.endIndex) return { from, to, text: "" };
  const start = range.$from.posAtIndex(first, range.depth);
  const nodes: JSONContent[] = [];
  for (let i = first; i < range.endIndex; i++) nodes.push(range.parent.child(i).toJSON());
  const name = range.parent.type.name;
  const text = plainBetween(doc, start, range.end);
  if (isWriteList(name)) {
    const attrs = name === "orderedList" ? { ...range.parent.attrs, start: Number(range.parent.attrs.start ?? 1) + first } : range.parent.attrs;
    return { from: start, to: range.end, text, spot: { kind: "items", list: name }, doc: { type: "doc", content: [{ type: name, attrs, content: nodes }] } };
  }
  return { from: start, to: range.end, text, spot: { kind: "blocks", in: isCell(name) ? "cell" : "block" }, doc: { type: "doc", content: nodes } };
}

/** `content` over [from, to) when the node there can hold it exactly; null
 * when it would have to split or nest something to fit. */
function replaceExactly(state: EditorState, from: number, to: number, content: JSONContent[] | null) {
  if (!content?.length) return null;
  const { doc, schema } = state;
  try {
    const $a = doc.resolve(from);
    const $b = doc.resolve(to);
    const fragment = Fragment.fromArray(content.map((node) => schema.nodeFromJSON(node)));
    if (!$a.sameParent($b) || !$a.parent.canReplace($a.index(), $b.index(), fragment)) return null;
    return state.tr.replaceWith(from, to, fragment);
  } catch {
    return null;
  }
}

/** Replace: the answer over the selection (target is the captured range,
 * moved along with edits since), as replaceFit decided. null when the doc
 * there no longer allows it. */
export function placeReplace(state: EditorState, target: { from: number; to: number }, fit: WriteFit, written: Written): Transaction | null {
  const $from = state.doc.resolve(target.from);
  // The line (and its item) must still be only the selected text.
  const wholeLine = $from.parent.isTextblock && target.from <= $from.start() && target.to >= $from.end();
  switch (fit) {
    case "inline":
      return $from.parent.isTextblock ? replaceExactly(state, target.from, target.to, written.inline) : null;
    case "line":
      return wholeLine ? replaceExactly(state, $from.before(), $from.after(), written.blocks) : null;
    case "item":
      return wholeLine && $from.node($from.depth - 1).childCount === 1
        ? replaceExactly(state, $from.before($from.depth - 1), $from.after($from.depth - 1), written.items)
        : null;
    case "items":
      return replaceExactly(state, target.from, target.to, written.items);
    case "blocks":
      return replaceExactly(state, target.from, target.to, written.blocks);
    default:
      return null;
  }
}

/** Insert below: the answer right after the selection, as belowFit decided. */
export function placeBelow(state: EditorState, target: { from: number; to: number }, below: WriteBelow, written: Written): Transaction | null {
  const { doc } = state;
  const $from = doc.resolve(target.from);
  switch (below) {
    case "afterItem": {
      const at = $from.after($from.depth - 1);
      return replaceExactly(state, at, at, written.items);
    }
    case "afterItems":
      return replaceExactly(state, target.to, target.to, written.items);
    case "afterBlocks":
      return replaceExactly(state, target.to, target.to, written.blocks);
    default: {
      const $to = doc.resolve(target.to);
      const at = $to.depth > 0 ? $to.after(1) : target.to;
      return replaceExactly(state, at, at, written.blocks);
    }
  }
}

/**
 * Help me write on whole blocks the AI chose (a typed request with nothing
 * selected, WritePlace "replace" with from/to): where they are now, and the
 * answer in their place or below them. The phone runs the same steps
 * (writeFindBlocks and writePlaceBlocks in WRITE_RANGE_JS).
 */

/** Where the blocks the AI read sit now: the run of the doc's top-level
 * blocks equal to `nodes` nearest `index` (where they were), as positions
 * and that index. null when the doc no longer holds them as they were, so a
 * draft never takes the place of text the AI did not see. */
export function findBlocks(doc: PMNode, nodes: readonly PMNode[], index: number): { from: number; to: number; index: number } | null {
  if (!nodes.length) return null;
  let best = -1;
  for (let i = 0; i + nodes.length <= doc.childCount; i++) {
    if (!nodes.every((node, j) => doc.child(i + j).eq(node))) continue;
    if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i;
  }
  if (best < 0) return null;
  let from = 0;
  for (let i = 0; i < best; i++) from += doc.child(i).nodeSize;
  let to = from;
  for (let j = 0; j < nodes.length; j++) to += doc.child(best + j).nodeSize;
  return { from, to, index: best };
}

/** A list right before `pos` and one of the same kind right after it become
 * one list. */
function joinLists(tr: Transaction, pos: number) {
  const $pos = tr.doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  if (before && after && before.type === after.type && isWriteList(before.type.name)) tr.join(pos);
}

/** The answer's blocks over [from, to) of the doc's top level (findBlocks;
 * from === to puts them there), joined to a list of the same kind right
 * above or below it, so bullets made a checklist under a checklist read as
 * one list. */
export function placeBlocks(state: EditorState, range: { from: number; to: number }, blocks: JSONContent[]): Transaction | null {
  if (!blocks.length) return null;
  try {
    const $a = state.doc.resolve(range.from);
    const $b = state.doc.resolve(range.to);
    if ($a.depth !== 0 || $b.depth !== 0) return null;
    const fragment = Fragment.fromArray(blocks.map((node) => state.schema.nodeFromJSON(node)));
    if (!state.doc.canReplace($a.index(), $b.index(), fragment)) return null;
    const tr = state.tr.replaceWith(range.from, range.to, fragment);
    joinLists(tr, range.from + fragment.size);
    joinLists(tr, range.from);
    return tr;
  } catch {
    return null;
  }
}
