/**
 * Help me write on a selection in the phone's doc editor: what is sent and
 * where the answer goes. Replace only ever puts the answer over exactly what
 * was sent, so it never deletes text the AI did not see, never splits a
 * line, list item or table, and never nests a list in a line or a table in a
 * table cell. These are the steps of the web editor's
 * apps/web/app/_components/editor/writeRange.ts, kept here as source so a
 * Node test (scripts/help-me-write-range.test.mjs) runs the same code the
 * editor WebView runs, on the same docs as the web's. Plain JS only: it is
 * pasted into the editor page as is, where `Fragment` is ProseMirror's.
 *
 * - writeCapture(state): { from, to, text, doc, spot } for the selection
 *   (WriteSpot in packages/contract/src/helpMeWrite.ts).
 * - writePlainBetween(doc, from, to): the plain text compared before the
 *   answer goes in.
 * - writePlaceReplace(state, target, fit, written) and
 *   writePlaceBelow(state, target, below, written): the transaction, or
 *   null when the doc there does not allow it.
 * - writeFindBlocks(doc, nodes, index) and writePlaceBlocks(state, range,
 *   blocks): whole blocks the AI chose to replace (findBlocks and
 *   placeBlocks on the web).
 */
export const WRITE_RANGE_JS = String.raw`
const writeLeafText = (node) =>
  node.type.name === "mention" ? "@" + String(node.attrs.label == null ? "" : node.attrs.label) : node.type.name === "hardBreak" ? "\n" : "";
function writePlainBetween(doc, from, to) {
  return doc.textBetween(from, to, "\n", writeLeafText).trim();
}
const WRITE_TAKEN_WHOLE = { table: true, tableRow: true, listItem: true, taskItem: true, columns: true, details: true };
const WRITE_ITEM_LISTS = { taskList: true, bulletList: true, orderedList: true };
const writeIsCell = (name) => name === "tableCell" || name === "tableHeader";

function writeLineEndBefore(doc, pos) {
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

function writeLineStartAfter(doc, pos) {
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

function writeCapture(state) {
  const doc = state.doc;
  let from = state.selection.from;
  let to = state.selection.to;
  if (from === to) return { from, to, text: "" };
  const $end = doc.resolve(to);
  if ($end.depth > 0 && $end.parent.isTextblock && $end.parentOffset === 0) {
    const back = writeLineEndBefore(doc, $end.before());
    if (back > from) to = back;
  }
  const $start = doc.resolve(from);
  if ($start.depth > 0 && $start.parent.isTextblock && $start.parentOffset === $start.parent.content.size) {
    const ahead = writeLineStartAfter(doc, $start.after());
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
    const spot = inItem
      ? { kind: "line", whole, in: "item", list: WRITE_ITEM_LISTS[list] ? list : null, alone: holder.childCount === 1 }
      : { kind: "line", whole, in: writeIsCell(holder.type.name) ? "cell" : "block" };
    const words = line.content.cut($from.parentOffset, $to.parentOffset);
    return {
      from,
      to,
      text: writePlainBetween(doc, from, to),
      spot,
      doc: line.type.spec.code ? undefined : { type: "doc", content: [{ type: "paragraph", content: words.toJSON() || [] }] },
    };
  }
  const range = $from.blockRange($to, (node) => !WRITE_TAKEN_WHOLE[node.type.name]);
  if (!range) return { from, to, text: "" };
  let first = range.startIndex;
  if (range.depth === 0 && first === 0 && range.parent.firstChild && range.parent.firstChild.type.name === "frontmatter") first = 1;
  if (first >= range.endIndex) return { from, to, text: "" };
  const start = range.$from.posAtIndex(first, range.depth);
  const nodes = [];
  for (let i = first; i < range.endIndex; i++) nodes.push(range.parent.child(i).toJSON());
  const name = range.parent.type.name;
  const text = writePlainBetween(doc, start, range.end);
  if (WRITE_ITEM_LISTS[name]) {
    const attrs = name === "orderedList" ? Object.assign({}, range.parent.attrs, { start: Number(range.parent.attrs.start == null ? 1 : range.parent.attrs.start) + first }) : range.parent.attrs;
    return { from: start, to: range.end, text, spot: { kind: "items", list: name }, doc: { type: "doc", content: [{ type: name, attrs, content: nodes }] } };
  }
  return { from: start, to: range.end, text, spot: { kind: "blocks", in: writeIsCell(name) ? "cell" : "block" }, doc: { type: "doc", content: nodes } };
}

function writeReplaceExactly(state, from, to, content) {
  if (!content || !content.length) return null;
  try {
    const $a = state.doc.resolve(from);
    const $b = state.doc.resolve(to);
    const fragment = Fragment.fromArray(content.map((node) => state.schema.nodeFromJSON(node)));
    if (!$a.sameParent($b) || !$a.parent.canReplace($a.index(), $b.index(), fragment)) return null;
    return state.tr.replaceWith(from, to, fragment);
  } catch (_) {
    return null;
  }
}

function writePlaceReplace(state, target, fit, written) {
  const $from = state.doc.resolve(target.from);
  const wholeLine = $from.parent.isTextblock && target.from <= $from.start() && target.to >= $from.end();
  switch (fit) {
    case "inline":
      return $from.parent.isTextblock ? writeReplaceExactly(state, target.from, target.to, written.inline) : null;
    case "line":
      return wholeLine ? writeReplaceExactly(state, $from.before(), $from.after(), written.blocks) : null;
    case "item":
      return wholeLine && $from.node($from.depth - 1).childCount === 1
        ? writeReplaceExactly(state, $from.before($from.depth - 1), $from.after($from.depth - 1), written.items)
        : null;
    case "items":
      return writeReplaceExactly(state, target.from, target.to, written.items);
    case "blocks":
      return writeReplaceExactly(state, target.from, target.to, written.blocks);
    default:
      return null;
  }
}

function writePlaceBelow(state, target, below, written) {
  const $from = state.doc.resolve(target.from);
  if (below === "afterItem") {
    const at = $from.after($from.depth - 1);
    return writeReplaceExactly(state, at, at, written.items);
  }
  if (below === "afterItems") return writeReplaceExactly(state, target.to, target.to, written.items);
  if (below === "afterBlocks") return writeReplaceExactly(state, target.to, target.to, written.blocks);
  const $to = state.doc.resolve(target.to);
  const at = $to.depth > 0 ? $to.after(1) : target.to;
  return writeReplaceExactly(state, at, at, written.blocks);
}

function writeFindBlocks(doc, nodes, index) {
  if (!nodes || !nodes.length) return null;
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

function writeJoinLists(tr, pos) {
  const $pos = tr.doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  if (before && after && before.type === after.type && WRITE_ITEM_LISTS[before.type.name]) tr.join(pos);
}

function writePlaceBlocks(state, range, blocks) {
  if (!blocks || !blocks.length) return null;
  try {
    const $a = state.doc.resolve(range.from);
    const $b = state.doc.resolve(range.to);
    if ($a.depth !== 0 || $b.depth !== 0) return null;
    const fragment = Fragment.fromArray(blocks.map((node) => state.schema.nodeFromJSON(node)));
    if (!state.doc.canReplace($a.index(), $b.index(), fragment)) return null;
    const tr = state.tr.replaceWith(range.from, range.to, fragment);
    writeJoinLists(tr, range.from + fragment.size);
    writeJoinLists(tr, range.from);
    return tr;
  } catch (_) {
    return null;
  }
}
`;
