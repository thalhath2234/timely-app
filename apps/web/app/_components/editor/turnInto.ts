import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * Turn into, from the block menu: the selected blocks (side by side in one
 * parent, such as a few to-dos of a list or a heading) become another kind.
 * Their lines keep their words and formatting, a to-do keeps its tick when
 * it stays a to-do, and an item's nested blocks stay under it (or follow it
 * when it stops being an item). Items taken out of a list split the list
 * around them; a list made next to a list of the same kind joins it.
 *
 * The phone's editor WebView runs the same steps (BLOCK_TURN_JS in
 * apps/mobile/lib/blockTurn.ts); scripts/block-turn.test.mjs runs both on
 * the same docs.
 */

export type TurnKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "toggle" | "callout" | "code";

type Line = { content: Fragment; checked: boolean; rest: PMNode[] };

const LISTS: Partial<Record<TurnKind, string>> = { bullet: "bulletList", ordered: "orderedList", task: "taskList" };
const LIST_KIND: Record<string, TurnKind> = { bulletList: "bullet", orderedList: "ordered", taskList: "task" };
const ITEMS: Record<string, true> = { listItem: true, taskItem: true };
const WRAPPERS: Record<string, true> = { blockquote: true, callout: true, details: true };
/** A live block's words are its program, not text to turn into anything. */
const LIVE_LANG = "openui-lang";

function hasImage(node: PMNode) {
  let found = node.type.name === "image";
  node.descendants((child) => {
    if (child.type.name === "image") found = true;
    return !found;
  });
  return found;
}

/** Adds the block's lines to `out`; false when it holds something that is not text (an image, a table). */
function addLines(node: PMNode, out: Line[]): boolean {
  const name = node.type.name;
  const schema = node.type.schema;
  if (name === "paragraph" || name === "heading" || name === "detailsSummary") {
    if (hasImage(node)) return false;
    out.push({ content: node.content, checked: false, rest: [] });
    return true;
  }
  if (name === "codeBlock") {
    if (node.attrs.language === LIVE_LANG) return false;
    for (const line of node.textContent.split("\n")) {
      out.push({ content: schema.nodes.paragraph.create(null, line ? schema.text(line) : null).content, checked: false, rest: [] });
    }
    return true;
  }
  if (ITEMS[name]) {
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph" || hasImage(first)) return false;
    const rest: PMNode[] = [];
    node.forEach((child, _offset, index) => {
      if (index > 0) rest.push(child);
    });
    out.push({ content: first.content, checked: name === "taskItem" && Boolean(node.attrs.checked), rest });
    return true;
  }
  if (LIST_KIND[name] || WRAPPERS[name]) {
    let ok = true;
    node.forEach((child) => {
      ok = ok && addLines(child, out);
    });
    return ok;
  }
  return false;
}

/** What the range's blocks are now: the kind they share, or null. */
function currentKind(nodes: PMNode[], parent: PMNode): TurnKind | null {
  if (LIST_KIND[parent.type.name]) return LIST_KIND[parent.type.name];
  const kinds = new Set(
    nodes.map((node): TurnKind | null => {
      const name = node.type.name;
      if (name === "paragraph") return "paragraph";
      if (name === "heading") return node.attrs.level <= 3 ? (`h${node.attrs.level}` as TurnKind) : null;
      if (name === "codeBlock") return "code";
      if (name === "callout") return "callout";
      if (name === "details") return "toggle";
      return LIST_KIND[name] ?? null;
    }),
  );
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** The range's blocks and lines, or null when Turn into does not apply to them. */
export function turnSpot(doc: PMNode, range: { from: number; to: number }) {
  if (range.from < 0 || range.to > doc.content.size || range.to <= range.from) return null;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  const start = $from.start();
  const nodes: PMNode[] = [];
  let first = -1;
  let last = -1;
  parent.forEach((node, offset, index) => {
    const pos = start + offset;
    if (pos >= range.from && pos + node.nodeSize <= range.to) {
      nodes.push(node);
      if (first < 0) first = index;
      last = index;
    }
  });
  if (nodes.length === 0) return null;
  const lines: Line[] = [];
  for (const node of nodes) if (!addLines(node, lines)) return null;
  const inList = Boolean(LIST_KIND[parent.type.name]);
  return {
    $from,
    nodes,
    lines,
    first,
    last,
    inList,
    current: currentKind(nodes, parent),
    // A toggle's title is one line: one block, not a whole list.
    toggle: nodes.length === 1 && !LIST_KIND[nodes[0].type.name],
  };
}

const leafText = (node: PMNode) => (node.type.name === "mention" ? `@${node.attrs.label ?? ""}` : node.type.name === "hardBreak" ? "\n" : "");

/** Every line's words, nested blocks included, for a code block. */
function plainLines(lines: Line[], out: string[] = []) {
  for (const line of lines) {
    out.push(line.content.textBetween(0, line.content.size, "", leafText));
    for (const block of line.rest) {
      const inner: Line[] = [];
      if (addLines(block, inner)) plainLines(inner, out);
      else out.push(block.textContent);
    }
  }
  return out;
}

/** The blocks the lines become. */
function build(state: EditorState, spot: NonNullable<ReturnType<typeof turnSpot>>, kind: TurnKind): PMNode[] | null {
  const { nodes: types } = state.schema;
  const text = (line: Line) => types.paragraph.create(null, line.content);
  const withRest = (line: Line) => [text(line), ...line.rest];
  if (kind === "paragraph") return spot.lines.flatMap(withRest);
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const level = Number(kind[1]);
    return spot.lines.flatMap((line) => [types.heading.create({ level }, line.content), ...line.rest]);
  }
  const list = LISTS[kind];
  if (list) {
    const item = kind === "task" ? types.taskItem : types.listItem;
    const items = spot.lines.map((line) => item.create(kind === "task" ? { checked: line.checked } : null, withRest(line)));
    return [types[list].create(null, items)];
  }
  if (kind === "code") {
    const words = plainLines(spot.lines).join("\n");
    return [types.codeBlock.create(null, words ? state.schema.text(words) : null)];
  }
  if (kind === "callout") {
    // Whole blocks go in as they are; a quote, callout or toggle gives its own blocks.
    const inner = spot.inList
      ? spot.lines.flatMap(withRest)
      : spot.nodes.flatMap((node): PMNode[] => {
          if (node.type.name === "blockquote" || node.type.name === "callout") return [...node.children];
          if (node.type.name === "details") return [types.paragraph.create(null, node.firstChild!.content), ...node.children.slice(1)];
          return [node];
        });
    return [types.callout.create({ kind: "note" }, inner)];
  }
  if (kind === "toggle") {
    if (!spot.toggle) return null;
    const [head, ...others] = spot.lines;
    const title = head.content.textBetween(0, head.content.size, " ", (node) => leafText(node).replace("\n", " "));
    const body = [...head.rest, ...others.flatMap(withRest)];
    return [types.details.create({ open: true }, [types.detailsSummary.create(null, title ? state.schema.text(title) : null), ...(body.length ? body : [types.paragraph.create()])])];
  }
  return null;
}

/** The transaction that turns the range's blocks into `kind`, or null when it does not apply. */
export function turnBlocks(state: EditorState, range: { from: number; to: number }, kind: TurnKind): Transaction | null {
  const spot = turnSpot(state.doc, range);
  if (!spot || spot.current === kind) return null;
  const made = build(state, spot, kind);
  if (!made || made.length === 0) return null;

  const { $from } = spot;
  let pieces: PMNode[];
  let container: PMNode;
  let startIndex: number;
  let endIndex: number;
  let from: number;
  let to: number;
  // Where the first made block starts within the pieces.
  let rel = 0;
  if (spot.inList) {
    // The items leave their list, which splits around them.
    const list = $from.parent;
    const before: PMNode[] = [];
    const after: PMNode[] = [];
    list.forEach((child, _offset, index) => {
      if (index < spot.first) before.push(child);
      else if (index > spot.last) after.push(child);
    });
    const head = before.length ? [list.type.create(list.attrs, before)] : [];
    const tail = after.length ? [list.type.create(list.attrs, after)] : [];
    pieces = [...head, ...made, ...tail];
    rel = head.length ? head[0].nodeSize : 0;
    container = $from.node(-1);
    startIndex = $from.index(-1);
    endIndex = startIndex + 1;
    from = $from.before();
    to = $from.after();
  } else {
    pieces = made;
    container = $from.parent;
    startIndex = spot.first;
    endIndex = spot.last + 1;
    from = $from.posAtIndex(startIndex);
    to = $from.posAtIndex(endIndex);
  }

  // A list next to a list of the same kind joins it.
  const prev = startIndex > 0 ? container.child(startIndex - 1) : null;
  if (prev && LIST_KIND[prev.type.name] && prev.type === pieces[0].type) {
    rel = rel === 0 ? prev.nodeSize - 1 : rel + prev.nodeSize - 2;
    pieces[0] = prev.type.create(prev.attrs, prev.content.append(pieces[0].content));
    from -= prev.nodeSize;
    startIndex -= 1;
  }
  const next = endIndex < container.childCount ? container.child(endIndex) : null;
  const end = pieces.length - 1;
  if (next && LIST_KIND[next.type.name] && next.type === pieces[end].type) {
    pieces[end] = pieces[end].type.create(pieces[end].attrs, pieces[end].content.append(next.content));
    to += next.nodeSize;
    endIndex += 1;
  }

  if (!container.canReplace(startIndex, endIndex, Fragment.from(pieces))) return null;
  const tr = state.tr.replaceWith(from, to, pieces);
  // The caret goes to the end of the first turned line.
  const near = TextSelection.near(tr.doc.resolve(Math.min(from + rel, tr.doc.content.size)), 1);
  return tr.setSelection(TextSelection.create(tr.doc, near.$from.end()));
}
