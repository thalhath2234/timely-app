// Turn into from the block menu: which blocks it applies to and what each
// kind makes of them. The web editor (apps/web/app/_components/editor/turnInto.ts)
// and the phone's editor WebView (BLOCK_TURN_JS in apps/mobile/lib/blockTurn.ts)
// run the same cases here, on a schema with the editor's node names.
import assert from "node:assert/strict";
import test, { describe } from "node:test";

// The ProseMirror copy the web editor's module imports.
const { Fragment, Schema } = await import("../apps/web/node_modules/@tiptap/pm/dist/model/index.js");
const { EditorState, TextSelection } = await import("../apps/web/node_modules/@tiptap/pm/dist/state/index.js");
const web = await import("../apps/web/app/_components/editor/turnInto.ts");
const { BLOCK_TURN_JS } = await import("../apps/mobile/lib/blockTurn.ts");
const phone = new Function("Fragment", "TextSelection", `${BLOCK_TURN_JS}; return { turnSpot, turnBlocks };`)(Fragment, TextSelection);

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    codeBlock: { group: "block", content: "text*", marks: "", code: true, attrs: { language: { default: null } } },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
    image: { group: "inline", inline: true, attrs: { src: { default: null } } },
    mention: { group: "inline", inline: true, atom: true, attrs: { id: { default: null }, label: { default: null } } },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+", attrs: { start: { default: 1 } } },
    listItem: { content: "paragraph block*" },
    taskList: { group: "block", content: "taskItem+" },
    taskItem: { content: "paragraph block*", attrs: { checked: { default: false } } },
    blockquote: { group: "block", content: "block+" },
    callout: { group: "block", content: "block+", attrs: { kind: { default: "note" } } },
    details: { group: "block", content: "detailsSummary block+", attrs: { open: { default: true } } },
    detailsSummary: { content: "text*" },
    table: { group: "block", content: "tableRow+" },
    tableRow: { content: "tableCell+" },
    tableCell: { content: "block+" },
  },
  marks: { bold: {} },
});

// Builders.
const t = (text, bold) => (bold ? { type: "text", text, marks: [{ type: "bold" }] } : { type: "text", text });
const p = (...content) => ({ type: "paragraph", ...(content.length ? { content: content.map((c) => (typeof c === "string" ? t(c) : c)) } : {}) });
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [t(text)] });
const todo = (text, checked = false, ...rest) => ({ type: "taskItem", attrs: { checked }, content: [p(text), ...rest] });
const item = (text, ...rest) => ({ type: "listItem", content: [p(text), ...rest] });
const todos = (...items) => ({ type: "taskList", content: items });
const bullets = (...items) => ({ type: "bulletList", content: items });
const numbers = (...items) => ({ type: "orderedList", attrs: { start: 1 }, content: items });
const code = (text, language = null) => ({ type: "codeBlock", attrs: { language }, content: text ? [t(text)] : undefined });
const callout = (...content) => ({ type: "callout", attrs: { kind: "note" }, content });
const details = (summary, ...body) => ({ type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", content: [t(summary)] }, ...body] });

const docOf = (...content) => schema.nodeFromJSON({ type: "doc", content });
// The range of the node at path (child indexes from the doc), as the block menu passes it.
function rangeAt(doc, path, count = 1) {
  let pos = 0;
  let node = doc;
  for (const [depth, index] of path.entries()) {
    if (depth > 0) pos += 1; // into the node
    for (let i = 0; i < index; i++) pos += node.child(i).nodeSize;
    if (depth < path.length - 1) node = node.child(index);
  }
  let to = pos;
  for (let i = 0; i < count; i++) to += node.child(path[path.length - 1] + i).nodeSize;
  return { from: pos, to };
}

const json = (doc) => JSON.parse(JSON.stringify(doc.toJSON()));
// Normalises what the schema fills in, so expectations stay short.
const norm = (doc) => json(schema.nodeFromJSON({ type: "doc", content: doc }));

for (const [name, impl] of [
  ["web", web],
  ["phone", phone],
]) {
  describe(`${name}: Turn into`, () => {
    const turn = (doc, range, kind) => {
      const state = EditorState.create({ schema, doc });
      const tr = impl.turnBlocks(state, range, kind);
      return tr ? { doc: json(tr.doc), caret: tr.selection } : null;
    };

    test("a to-do in a list turns into text and the list splits around it", () => {
      const doc = docOf(todos(todo("Onion"), todo("Milk", true), todo("Pasta")));
      const out = turn(doc, rangeAt(doc, [0, 1]), "paragraph");
      assert.deepEqual(out.doc, norm([todos(todo("Onion")), p("Milk"), todos(todo("Pasta"))]));
      // The caret ends the turned line.
      assert.equal(out.caret.$from.parent.textContent, "Milk");
      assert.equal(out.caret.$from.parentOffset, 4);
    });

    test("a to-do turns into a heading, a bullet and a toggle; Turn into is offered for it", () => {
      const doc = docOf(todos(todo("Onion"), todo("Cereal")));
      const range = rangeAt(doc, [0, 1]);
      const spot = impl.turnSpot(doc, range);
      assert.equal(spot.current, "task");
      assert.equal(spot.toggle, true);
      assert.deepEqual(turn(doc, range, "h1").doc, norm([todos(todo("Onion")), h(1, "Cereal")]));
      assert.deepEqual(turn(doc, range, "bullet").doc, norm([todos(todo("Onion")), bullets(item("Cereal"))]));
      assert.deepEqual(turn(doc, range, "toggle").doc, norm([todos(todo("Onion")), details("Cereal", p())]));
      assert.equal(turn(doc, range, "task"), null, "already a to-do");
    });

    test("an item next to a list of the new kind joins it, so a bullet turned back is one list again", () => {
      const doc = docOf(todos(todo("Onion")), bullets(item("Milk")), todos(todo("Pasta")));
      assert.deepEqual(turn(doc, rangeAt(doc, [1, 0]), "task").doc, norm([todos(todo("Onion"), todo("Milk"), todo("Pasta"))]));
    });

    test("a whole list changes kind and keeps nested items and ticks", () => {
      const nested = bullets(item("Sub"));
      const doc = docOf(todos(todo("A", true, nested), todo("B")));
      const asBullets = turn(doc, rangeAt(doc, [0]), "bullet").doc;
      assert.deepEqual(asBullets, norm([bullets(item("A", nested), item("B"))]));
      assert.deepEqual(turn(doc, rangeAt(doc, [0]), "ordered").doc, norm([numbers(item("A", nested), item("B"))]));
      assert.equal(impl.turnSpot(doc, rangeAt(doc, [0])).toggle, false, "a whole list is not one toggle title");
    });

    test("a to-do's nested blocks follow it when it becomes text", () => {
      const nested = todos(todo("Sub"));
      const doc = docOf(todos(todo("A", false, nested), todo("B")));
      assert.deepEqual(turn(doc, rangeAt(doc, [0, 0]), "paragraph").doc, norm([p("A"), nested, todos(todo("B"))]));
    });

    test("a nested to-do turns into text inside its parent item", () => {
      const doc = docOf(todos(todo("A", false, todos(todo("x"), todo("y")))));
      assert.deepEqual(turn(doc, rangeAt(doc, [0, 0, 1, 0]), "paragraph").doc, norm([todos(todo("A", false, p("x"), todos(todo("y"))))]));
    });

    test("text keeps its formatting and joins a numbered list above it", () => {
      const doc = docOf(numbers(item("One")), p(t("Two", true)), h(2, "Three"));
      const out = turn(doc, rangeAt(doc, [1], 2), "ordered");
      assert.deepEqual(out.doc, norm([numbers(item("One"), { type: "listItem", content: [p(t("Two", true))] }, item("Three"))]));
      assert.equal(out.caret.$from.parent.textContent, "Two");
    });

    test("code turns into lines of text, and lines into one code block", () => {
      const doc = docOf(code("line one\nline two"));
      assert.equal(impl.turnSpot(doc, rangeAt(doc, [0])).current, "code");
      assert.deepEqual(turn(doc, rangeAt(doc, [0]), "paragraph").doc, norm([p("line one"), p("line two")]));
      const lines = docOf(p("a"), p(), p("b", { type: "mention", attrs: { id: "t1", label: "Task" } }));
      assert.deepEqual(turn(lines, rangeAt(lines, [0], 3), "code").doc, norm([code("a\n\nb@Task")]));
    });

    test("a callout and a quote give their lines back; text and lists go into a callout", () => {
      const doc = docOf(callout(p("Note"), bullets(item("x"))));
      assert.deepEqual(turn(doc, rangeAt(doc, [0]), "paragraph").doc, norm([p("Note"), p("x")]));
      const quote = docOf({ type: "blockquote", content: [p("Quoted")] });
      assert.equal(impl.turnSpot(quote, rangeAt(quote, [0])).current, null);
      assert.deepEqual(turn(quote, rangeAt(quote, [0]), "callout").doc, norm([callout(p("Quoted"))]));
      const list = docOf(bullets(item("x")));
      assert.deepEqual(turn(list, rangeAt(list, [0]), "callout").doc, norm([callout(bullets(item("x")))]));
    });

    test("a toggle turns into text: its title, then its body", () => {
      const doc = docOf(details("Title", p("Body")));
      assert.equal(impl.turnSpot(doc, rangeAt(doc, [0])).current, "toggle");
      assert.deepEqual(turn(doc, rangeAt(doc, [0]), "paragraph").doc, norm([p("Title"), p("Body")]));
    });

    test("blocks that are not text are not offered", () => {
      const table = docOf({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("x")] }] }] });
      assert.equal(impl.turnSpot(table, rangeAt(table, [0])), null);
      const image = docOf(p({ type: "image", attrs: { src: "/files/1" } }));
      assert.equal(impl.turnSpot(image, rangeAt(image, [0])), null);
      const live = docOf(code("@Stats()", "openui-lang"));
      assert.equal(impl.turnSpot(live, rangeAt(live, [0])), null);
      const imageTodo = docOf(todos(todo("x"), { type: "taskItem", attrs: { checked: false }, content: [p({ type: "image", attrs: { src: "/f" } })] }));
      assert.equal(impl.turnSpot(imageTodo, rangeAt(imageTodo, [0, 1])), null);
    });

    test("a heading 4 is offered every kind and a mixed selection none as current", () => {
      const doc = docOf(h(4, "Deep"), p("x"));
      assert.equal(impl.turnSpot(doc, rangeAt(doc, [0])).current, null);
      assert.equal(impl.turnSpot(doc, rangeAt(doc, [0], 2)).current, null);
      assert.deepEqual(turn(doc, rangeAt(doc, [0]), "h2").doc, norm([h(2, "Deep"), p("x")]));
    });
  });
}

test("web and phone turn the same docs the same way", () => {
  const doc = docOf(h(1, "Shopping"), todos(todo("Onion"), todo("Milk", true), todo("Cereal")), code("a\nb"), callout(p("c")));
  const kinds = ["paragraph", "h1", "h2", "h3", "bullet", "ordered", "task", "toggle", "callout", "code"];
  for (const path of [[0], [1], [1, 1], [2], [3]]) {
    for (const kind of kinds) {
      const state = EditorState.create({ schema, doc });
      const a = web.turnBlocks(state, rangeAt(doc, path), kind);
      const b = phone.turnBlocks(state, rangeAt(doc, path), kind);
      assert.deepEqual(a && json(a.doc), b && json(b.doc), `${path} ${kind}`);
      assert.equal(a && a.selection.from, b && b.selection.from, `${path} ${kind} caret`);
    }
  }
});
