// Help me write on a selection: what is sent, and what Replace and Insert
// below do to the doc. The web editor (apps/web/app/_components/editor/writeRange.ts)
// and the phone's editor WebView (WRITE_RANGE_JS in apps/mobile/lib/helpMeWriteRange.ts)
// run the same cases here, on a schema with the editor's node names.
import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

// The shared packages import their siblings without an extension, as the
// apps' bundlers allow; teach Node's loader the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

// The ProseMirror copy the web editor's module imports.
const { Fragment, Schema } = await import("../apps/web/node_modules/@tiptap/pm/dist/model/index.js");
const { EditorState, TextSelection, AllSelection } = await import("../apps/web/node_modules/@tiptap/pm/dist/state/index.js");
const { WRITE_TOO_LONG, belowFit, replaceFit, selectionTooLong, spotList, writtenContent } = await import(
  "../packages/contract/src/helpMeWrite.ts"
);
const web = await import("../apps/web/app/_components/editor/writeRange.ts");
const { WRITE_RANGE_JS } = await import("../apps/mobile/lib/helpMeWriteRange.ts");
const phone = new Function(
  "Fragment",
  `${WRITE_RANGE_JS}; return { captureSelection: writeCapture, plainBetween: writePlainBetween, placeReplace: writePlaceReplace, placeBelow: writePlaceBelow };`,
)(Fragment);

const cell = { content: "block+", attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } } };
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    codeBlock: { group: "block", content: "text*", marks: "", code: true, attrs: { language: { default: null } } },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { id: { default: null }, label: { default: null }, entityType: { default: "task" }, appearance: { default: null } },
    },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+", attrs: { start: { default: 1 }, type: { default: null } } },
    listItem: { content: "paragraph block*" },
    taskList: { group: "block", content: "taskItem+" },
    taskItem: { content: "paragraph block*", attrs: { checked: { default: false } } },
    table: { group: "block", content: "tableRow+" },
    tableRow: { content: "(tableCell | tableHeader)*" },
    tableCell: cell,
    tableHeader: cell,
  },
  marks: { link: { attrs: { href: {} } }, bold: {}, italic: {} },
});

// Builders for the docs below.
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (...content) => ({ type: "paragraph", content: content.map((c) => (typeof c === "string" ? t(c) : c)) });
const task = (checked, ...content) => ({ type: "taskItem", attrs: { checked }, content });
const tasks = (...items) => ({ type: "taskList", content: items });
const row = (...cells) => ({ type: "tableRow", content: cells });
const td = (kind, text) => ({ type: kind, content: [p(text)] });
const mention = { type: "mention", attrs: { id: "tsk_1", label: "Alice onboarding", entityType: "task" } };
const link = (text) => t(text, [{ type: "link", attrs: { href: "https://example.com/spec" } }]);

/** A state holding `content` with the text between the first `from` and the
 * end of the first `to` selected (or every block with to === "all"). */
function stateWith(content, from, to) {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  if (to === "all") return EditorState.create({ doc, selection: new AllSelection(doc) });
  const find = (text) => {
    let at = -1;
    doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text.includes(text)) at = pos + node.text.indexOf(text);
    });
    assert.ok(at >= 0, `no "${text}" in the doc`);
    return at;
  };
  const start = typeof from === "number" ? from : find(from);
  const end = typeof to === "number" ? to : find(to) + to.length;
  return EditorState.create({ doc, selection: TextSelection.create(doc, start, end) });
}

/** What the person ends up with after the panel's Replace or Insert below
 * with this answer, or null when it is not offered. */
function apply(impl, state, markdown, mode) {
  const captured = impl.captureSelection(state);
  const written = writtenContent(markdown, spotList(captured.spot));
  const target = { from: captured.from, to: captured.to };
  if (mode === "replace") {
    const fit = replaceFit(captured.spot, written);
    if (!fit) return null;
    const tr = impl.placeReplace(state, target, fit, written);
    assert.ok(tr, `${fit} did not apply`);
    return tr.doc.toJSON().content;
  }
  const tr = impl.placeBelow(state, target, belowFit(captured.spot, written), written);
  assert.ok(tr, "Insert below did not apply");
  return tr.doc.toJSON().content;
}

const plain = (content) => schema.nodeFromJSON({ type: "doc", content }).textBetween(0, schema.nodeFromJSON({ type: "doc", content }).content.size, "\n", (n) => (n.type.name === "mention" ? `@${n.attrs.label}` : ""));

for (const [name, impl] of [
  ["web", web],
  ["phone", phone],
]) {
  describe(`${name}: what is sent`, () => {
    test("a mention and a link in the selected words are sent, not dropped (GW1)", () => {
      const state = stateWith([p("See the ", link("spec"), " with ", mention, " tomorow, its realy important")], "See", "important");
      const captured = impl.captureSelection(state);
      assert.equal(captured.text, "See the spec with @Alice onboarding tomorow, its realy important");
      assert.deepEqual(captured.spot, { kind: "line", whole: true, in: "block" });
      const words = captured.doc.content[0].content;
      assert.ok(words.some((n) => n.type === "mention" && n.attrs.id === "tsk_1"), "the mention goes along");
      assert.ok(words.some((n) => n.marks?.[0]?.attrs?.href === "https://example.com/spec"), "the link goes along");
    });

    test("a selection across checklist items takes those items whole, ticks and all", () => {
      const state = stateWith([tasks(task(true, p("buy milk")), task(false, p("call bob")))], "milk", "call");
      const captured = impl.captureSelection(state);
      assert.equal(captured.text, "buy milk\ncall bob");
      assert.deepEqual(captured.spot, { kind: "items", list: "taskList" });
      assert.deepEqual(captured.doc.content[0].content.map((i) => i.attrs.checked), [true, false]);
    });

    test("a selection across table cells takes the whole table", () => {
      const table = { type: "table", content: [row(td("tableHeader", "Who"), td("tableHeader", "When")), row(td("tableCell", "Sam"), td("tableCell", "Monday"))] };
      const state = stateWith([p("Intro"), table, p("After")], "Who", "Monday");
      const captured = impl.captureSelection(state);
      assert.deepEqual(captured.spot, { kind: "blocks", in: "block" });
      assert.equal(captured.doc.content.length, 1);
      assert.equal(captured.doc.content[0].type, "table");
    });

    test("Select all of a long doc sends every line (W1)", () => {
      const lines = Array.from({ length: 119 }, (_, i) => p(`Line ${i + 1}: the crew will arrive at 10am and set up.`));
      lines.push(p("FINAL LINE: wrap up in December 2027."));
      const captured = impl.captureSelection(stateWith(lines, 0, "all"));
      assert.equal(captured.doc.content.length, 120);
      assert.ok(captured.text.endsWith("FINAL LINE: wrap up in December 2027."));
    });

    test("ending at the very start of the next line does not take that line", () => {
      const state = stateWith([p("First line"), p("Second line")], "First", 1 + "First line".length + 2);
      const captured = impl.captureSelection(state);
      assert.equal(captured.text, "First line");
      assert.equal(captured.spot.kind, "line");
    });
  });

  describe(`${name}: Replace and Insert below`, () => {
    test("fixing words keeps their mention and link (GW1)", () => {
      const state = stateWith([p("See the ", link("spec"), " with ", mention, " tomorow, its realy important")], "See", "important");
      const after = apply(impl, state, "See the [spec](https://example.com/spec) with [@Alice onboarding](timely://task/tsk_1) tomorrow, it's really important", "replace");
      assert.equal(after.length, 1);
      const line = after[0].content;
      assert.ok(line.some((n) => n.type === "mention" && n.attrs.id === "tsk_1" && n.attrs.label === "Alice onboarding"));
      assert.ok(line.some((n) => n.text === "spec" && n.marks[0].attrs.href === "https://example.com/spec"));
      assert.equal(plain(after), "See the spec with @Alice onboarding tomorrow, it's really important");
    });

    test("improving two checklist items gives two items, not a nested checklist (GW1)", () => {
      const state = stateWith([p("Shopping"), tasks(task(true, p("buy milk")), task(false, p("call bob"))), p("Done")], "milk", "call");
      const after = apply(impl, state, "- [x] Buy milk\n- [ ] Call Bob", "replace");
      assert.deepEqual(after.map((b) => b.type), ["paragraph", "taskList", "paragraph"]);
      const items = after[1].content;
      assert.equal(items.length, 2);
      assert.deepEqual(items.map((i) => [i.attrs.checked, i.content.length, i.content[0].content[0].text]), [
        [true, 1, "Buy milk"],
        [false, 1, "Call Bob"],
      ]);
    });

    test("shortening a table gives one table in its place, never a table in a cell (GW1)", () => {
      const table = { type: "table", content: [row(td("tableHeader", "Who"), td("tableHeader", "When")), row(td("tableCell", "Sam Smith"), td("tableCell", "Monday morning"))] };
      const state = stateWith([p("Intro"), table, p("After")], "Who", "Monday morning");
      const after = apply(impl, state, "| Who | When |\n| --- | --- |\n| Sam | Mon |", "replace");
      assert.deepEqual(after.map((b) => b.type), ["paragraph", "table", "paragraph"]);
      const cells = after[1].content.flatMap((r) => r.content);
      assert.deepEqual(cells.map((c) => c.content[0].type), ["paragraph", "paragraph", "paragraph", "paragraph"]);
      assert.equal(plain([after[1]]), "Who\nWhen\nSam\nMon");
    });

    test("a table answer for one cell's line is not offered as Replace", () => {
      const table = { type: "table", content: [row(td("tableHeader", "Who"), td("tableHeader", "When"))] };
      const state = stateWith([table], "Who", "Who");
      assert.equal(apply(impl, state, "| A | B |\n| --- | --- |\n| 1 | 2 |", "replace"), null);
    });

    test("Make steps on a few words of an item does not take the item or its sub-items (GW2)", () => {
      const doc = [
        tasks(task(false, p("Plan trip to Lisbon in May"), tasks(task(false, p("hotel")), task(false, p("visa")))), task(false, p("Pack"))),
      ];
      const state = stateWith(doc, "trip to Lisbon", "trip to Lisbon");
      const answer = "- [ ] Book flights\n- [ ] Pack bags";
      assert.equal(apply(impl, state, answer, "replace"), null, "Replace is not offered");
      // Insert below puts the steps right after the item, keeping every word.
      const after = apply(impl, state, answer, "below");
      const top = after[0].content;
      assert.deepEqual(top.map((i) => i.content[0].content[0].text), ["Plan trip to Lisbon in May", "Book flights", "Pack bags", "Pack"]);
      assert.deepEqual(top[0].content[1].content.map((i) => i.content[0].content[0].text), ["hotel", "visa"]);
    });

    test("Make steps on a whole item with no sub-items puts the steps in its place", () => {
      const state = stateWith([tasks(task(false, p("Plan the trip")), task(false, p("Pack")))], "Plan the trip", "Plan the trip");
      const after = apply(impl, state, "- [ ] Book flights\n- [ ] Pick dates", "replace");
      assert.deepEqual(after[0].content.map((i) => i.content[0].content[0].text), ["Book flights", "Pick dates", "Pack"]);
    });

    test("an item's whole line with sub-items keeps them: Replace is not offered for a list", () => {
      const doc = [tasks(task(false, p("Plan the trip"), tasks(task(false, p("hotel")))))];
      const state = stateWith(doc, "Plan the trip", "Plan the trip");
      assert.equal(apply(impl, state, "- [ ] Book flights\n- [ ] Pick dates", "replace"), null);
      // A one-line answer still replaces just the words.
      const after = apply(impl, state, "Plan the Lisbon trip", "replace");
      assert.equal(after[0].content[0].content[0].content[0].text, "Plan the Lisbon trip");
      assert.equal(after[0].content[0].content[1].content[0].content[0].content[0].text, "hotel");
    });

    test("Replace after Select all takes the answer's lines, every one (W1)", () => {
      const lines = Array.from({ length: 30 }, (_, i) => p(`Lnie ${i + 1}`));
      const state = stateWith(lines, 0, "all");
      const answer = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n\n");
      const after = apply(impl, state, answer, "replace");
      assert.equal(after.length, 30);
      assert.equal(after[29].content[0].text, "Line 30");
    });

    test("Insert below a selection of whole lines goes right after them, not at the end", () => {
      const state = stateWith([p("One"), p("Two"), p("Three")], "One", "Two");
      const after = apply(impl, state, "- Summary", "below");
      assert.deepEqual(after.map((b) => b.type), ["paragraph", "paragraph", "bulletList", "paragraph"]);
    });
  });
}

describe("the selection limit", () => {
  test("is measured in bytes, as the API measures it", () => {
    assert.equal(selectionTooLong("a".repeat(20_000)), false);
    assert.equal(selectionTooLong("a".repeat(20_001)), true);
    assert.equal(selectionTooLong("é".repeat(10_001)), true);
    assert.match(WRITE_TOO_LONG, /3,000 words/);
  });
});
