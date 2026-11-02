/**
 * Turn into, from the phone's Block menu (components/editor/BlockSheet.tsx):
 * the caret's block becomes another kind. These are the steps of the web
 * editor's apps/web/app/_components/editor/turnInto.ts, kept here as source
 * so a Node test (scripts/block-turn.test.mjs) runs the same code the editor
 * WebView runs, on the same docs as the web's. Plain JS only: it is pasted
 * into the editor page as is, where `Fragment` and `TextSelection` are
 * ProseMirror's.
 *
 * - turnSpot(doc, range): the range's blocks and lines, with `current` (the
 *   kind they are now) and `toggle` (whether they can be a toggle), or null
 *   when Turn into does not apply to them.
 * - turnBlocks(state, range, kind): the transaction, or null.
 *
 * Kinds: paragraph, h1, h2, h3, bullet, ordered, task, toggle, callout, code.
 */
export const BLOCK_TURN_JS = String.raw`
const TURN_LISTS = { bullet: "bulletList", ordered: "orderedList", task: "taskList" };
const TURN_LIST_KIND = { bulletList: "bullet", orderedList: "ordered", taskList: "task" };
const TURN_ITEMS = { listItem: true, taskItem: true };
const TURN_WRAPPERS = { blockquote: true, callout: true, details: true };
const TURN_LIVE_LANG = "openui-lang";

function turnHasImage(node) {
  let found = node.type.name === "image";
  node.descendants((child) => {
    if (child.type.name === "image") found = true;
    return !found;
  });
  return found;
}

function turnAddLines(node, out) {
  const name = node.type.name;
  const schema = node.type.schema;
  if (name === "paragraph" || name === "heading" || name === "detailsSummary") {
    if (turnHasImage(node)) return false;
    out.push({ content: node.content, checked: false, rest: [] });
    return true;
  }
  if (name === "codeBlock") {
    if (node.attrs.language === TURN_LIVE_LANG) return false;
    for (const line of node.textContent.split("\n")) {
      out.push({ content: schema.nodes.paragraph.create(null, line ? schema.text(line) : null).content, checked: false, rest: [] });
    }
    return true;
  }
  if (TURN_ITEMS[name]) {
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph" || turnHasImage(first)) return false;
    const rest = [];
    node.forEach((child, _offset, index) => {
      if (index > 0) rest.push(child);
    });
    out.push({ content: first.content, checked: name === "taskItem" && Boolean(node.attrs.checked), rest });
    return true;
  }
  if (TURN_LIST_KIND[name] || TURN_WRAPPERS[name]) {
    let ok = true;
    node.forEach((child) => {
      ok = ok && turnAddLines(child, out);
    });
    return ok;
  }
  return false;
}

function turnCurrentKind(nodes, parent) {
  if (TURN_LIST_KIND[parent.type.name]) return TURN_LIST_KIND[parent.type.name];
  const kinds = new Set(
    nodes.map((node) => {
      const name = node.type.name;
      if (name === "paragraph") return "paragraph";
      if (name === "heading") return node.attrs.level <= 3 ? "h" + node.attrs.level : null;
      if (name === "codeBlock") return "code";
      if (name === "callout") return "callout";
      if (name === "details") return "toggle";
      return TURN_LIST_KIND[name] || null;
    }),
  );
  return kinds.size === 1 ? Array.from(kinds)[0] : null;
}

function turnSpot(doc, range) {
  if (range.from < 0 || range.to > doc.content.size || range.to <= range.from) return null;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  const start = $from.start();
  const nodes = [];
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
  const lines = [];
  for (const node of nodes) if (!turnAddLines(node, lines)) return null;
  return {
    $from,
    nodes,
    lines,
    first,
    last,
    inList: Boolean(TURN_LIST_KIND[parent.type.name]),
    current: turnCurrentKind(nodes, parent),
    toggle: nodes.length === 1 && !TURN_LIST_KIND[nodes[0].type.name],
  };
}

const turnLeafText = (node) => (node.type.name === "mention" ? "@" + (node.attrs.label == null ? "" : node.attrs.label) : node.type.name === "hardBreak" ? "\n" : "");

function turnPlainLines(lines, out) {
  out = out || [];
  for (const line of lines) {
    out.push(line.content.textBetween(0, line.content.size, "", turnLeafText));
    for (const block of line.rest) {
      const inner = [];
      if (turnAddLines(block, inner)) turnPlainLines(inner, out);
      else out.push(block.textContent);
    }
  }
  return out;
}

function turnBuild(state, spot, kind) {
  const types = state.schema.nodes;
  const text = (line) => types.paragraph.create(null, line.content);
  const withRest = (line) => [text(line)].concat(line.rest);
  if (kind === "paragraph") return spot.lines.flatMap(withRest);
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const level = Number(kind[1]);
    return spot.lines.flatMap((line) => [types.heading.create({ level }, line.content)].concat(line.rest));
  }
  const list = TURN_LISTS[kind];
  if (list) {
    const item = kind === "task" ? types.taskItem : types.listItem;
    const items = spot.lines.map((line) => item.create(kind === "task" ? { checked: line.checked } : null, withRest(line)));
    return [types[list].create(null, items)];
  }
  if (kind === "code") {
    const words = turnPlainLines(spot.lines).join("\n");
    return [types.codeBlock.create(null, words ? state.schema.text(words) : null)];
  }
  if (kind === "callout") {
    const inner = spot.inList
      ? spot.lines.flatMap(withRest)
      : spot.nodes.flatMap((node) => {
          if (node.type.name === "blockquote" || node.type.name === "callout") return node.children.slice();
          if (node.type.name === "details") return [types.paragraph.create(null, node.firstChild.content)].concat(node.children.slice(1));
          return [node];
        });
    return [types.callout.create({ kind: "note" }, inner)];
  }
  if (kind === "toggle") {
    if (!spot.toggle) return null;
    const head = spot.lines[0];
    const others = spot.lines.slice(1);
    const title = head.content.textBetween(0, head.content.size, " ", (node) => turnLeafText(node).replace("\n", " "));
    const body = head.rest.concat(others.flatMap(withRest));
    return [types.details.create({ open: true }, [types.detailsSummary.create(null, title ? state.schema.text(title) : null)].concat(body.length ? body : [types.paragraph.create()]))];
  }
  return null;
}

function turnBlocks(state, range, kind) {
  const spot = turnSpot(state.doc, range);
  if (!spot || spot.current === kind) return null;
  const made = turnBuild(state, spot, kind);
  if (!made || made.length === 0) return null;

  const $from = spot.$from;
  let pieces, container, startIndex, endIndex, from, to;
  let rel = 0;
  if (spot.inList) {
    const list = $from.parent;
    const before = [];
    const after = [];
    list.forEach((child, _offset, index) => {
      if (index < spot.first) before.push(child);
      else if (index > spot.last) after.push(child);
    });
    const head = before.length ? [list.type.create(list.attrs, before)] : [];
    const tail = after.length ? [list.type.create(list.attrs, after)] : [];
    pieces = head.concat(made, tail);
    rel = head.length ? head[0].nodeSize : 0;
    container = $from.node(-1);
    startIndex = $from.index(-1);
    endIndex = startIndex + 1;
    from = $from.before();
    to = $from.after();
  } else {
    pieces = made.slice();
    container = $from.parent;
    startIndex = spot.first;
    endIndex = spot.last + 1;
    from = $from.posAtIndex(startIndex);
    to = $from.posAtIndex(endIndex);
  }

  const prev = startIndex > 0 ? container.child(startIndex - 1) : null;
  if (prev && TURN_LIST_KIND[prev.type.name] && prev.type === pieces[0].type) {
    rel = rel === 0 ? prev.nodeSize - 1 : rel + prev.nodeSize - 2;
    pieces[0] = prev.type.create(prev.attrs, prev.content.append(pieces[0].content));
    from -= prev.nodeSize;
    startIndex -= 1;
  }
  const next = endIndex < container.childCount ? container.child(endIndex) : null;
  const end = pieces.length - 1;
  if (next && TURN_LIST_KIND[next.type.name] && next.type === pieces[end].type) {
    pieces[end] = pieces[end].type.create(pieces[end].attrs, pieces[end].content.append(next.content));
    to += next.nodeSize;
    endIndex += 1;
  }

  if (!container.canReplace(startIndex, endIndex, Fragment.from(pieces))) return null;
  const tr = state.tr.replaceWith(from, to, pieces);
  const near = TextSelection.near(tr.doc.resolve(Math.min(from + rel, tr.doc.content.size)), 1);
  return tr.setSelection(TextSelection.create(tr.doc, near.$from.end()));
}
`;
