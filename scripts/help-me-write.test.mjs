import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

// helpMeWrite.ts imports its siblings without an extension, as the apps'
// bundlers allow; teach Node's loader the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

const { SELECTION_ACTIONS, shortenedNote, writeStarters, writtenContent } = await import(
  "../packages/contract/src/helpMeWrite.ts"
);

describe("writeStarters", () => {
  test("an empty task offers a description from its title", () => {
    const labels = writeStarters("task", false).map((s) => s.label);
    assert.deepEqual(labels, ["Write a description", "Break into steps"]);
  });
  test("a task with notes can be rewritten or continued", () => {
    const actions = writeStarters("project", true).map((s) => s.action);
    assert.deepEqual(actions, ["describe", "write", "continue"]);
  });
  test("an empty doc never offers Continue or Summarize", () => {
    const actions = writeStarters("doc", false).map((s) => s.action);
    assert.ok(!actions.includes("continue") && !actions.includes("summarize"));
  });
  test("prompt starters carry their prompt", () => {
    for (const s of [...writeStarters("doc", true), ...writeStarters("task", true)]) {
      if (s.action === "write") assert.ok(s.prompt, s.label);
    }
  });
  test("selection actions are the API's rewrite actions", () => {
    assert.deepEqual(
      SELECTION_ACTIONS.map((a) => a.action),
      ["improve", "shorter", "longer", "fix", "steps", "summarize"],
    );
  });
});

describe("writtenContent", () => {
  test("one paragraph comes back inline so it can replace words", () => {
    const { blocks, inline } = writtenContent("Book the **cheapest** direct flight.");
    assert.equal(blocks.length, 1);
    assert.equal(inline?.[0]?.text, "Book the ");
    assert.deepEqual(inline?.[1]?.marks, [{ type: "bold" }]);
  });
  test("headings and checklists become blocks", () => {
    const { blocks, inline } = writtenContent("## Plan\n\n- [ ] Book flights\n- [x] Pick dates");
    assert.equal(inline, null);
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["heading", "taskList"],
    );
    assert.equal(blocks[1].content.length, 2);
  });
  test('"- []" items are checklist items, not "[]" text', () => {
    const { blocks } = writtenContent("- [] Rice\n- [] Yogurt");
    assert.equal(blocks[0].type, "taskList");
    assert.equal(blocks[0].content[0].content[0].content[0].text, "Rice");
  });
  test("a box with no text is not an item, and code is left as written", () => {
    const { blocks, items } = writtenContent("- [ ] Rice\n- Yogurt\n- [ ]", "taskList");
    assert.deepEqual(items.map((item) => item.content[0].content[0].text), ["Rice", "Yogurt"]);
    assert.equal(blocks[0].content.length, 2);
    assert.deepEqual(writtenContent("- []").blocks, []);
    const code = writtenContent("```yaml\nexclude:\n  - []\n```").blocks[0];
    assert.equal(code.type, "codeBlock");
    assert.equal(code.content[0].text, "exclude:\n  - []");
  });
  test("a list mixing tick boxes and bullets becomes a checklist", () => {
    const { blocks } = writtenContent("- [ ] Rice\n- Yogurt\n- [x] Mint");
    assert.equal(blocks[0].type, "taskList");
    assert.deepEqual(
      blocks[0].content.map((item) => [item.attrs.checked, item.content[0].content[0].text]),
      [[false, "Rice"], [false, "Yogurt"], [true, "Mint"]],
    );
  });
  test("a bulleted answer joins a checklist as unticked items", () => {
    const { blocks, items } = writtenContent("- Rice\n- Yogurt\n  - Greek", "taskList");
    assert.deepEqual(items.map((item) => item.type), ["taskItem", "taskItem"]);
    assert.equal(items[0].attrs.checked, false);
    assert.equal(items[1].content[1].type, "taskList", "nested bullets become nested checklist items");
    assert.equal(blocks[0].type, "taskList", "the preview shows tick boxes");
  });
  test("a checklist answer keeps its boxes beside a bulleted list", () => {
    assert.equal(writtenContent("- [ ] Rice", "bulletList").items, null);
    assert.equal(writtenContent("1. Rice\n2. Yogurt", "bulletList").items.length, 2);
  });
  test("only a one-list answer joins a list", () => {
    assert.equal(writtenContent("## Spices\n\n- Cumin", "taskList").items, null);
    assert.equal(writtenContent("Just this line", "taskList").items, null);
  });
});

describe("shortenedNote", () => {
  test("says a long doc's middle was not read, in the editor's own words", () => {
    assert.equal(shortenedNote("doc"), "This doc is long, so the AI read its start and end but not the middle.");
    assert.match(shortenedNote("task"), /^This description is long/);
  });
});

const { WRITE_CURSOR, WRITE_TOO_LONG, replacesAll, writeCursorMark, writeTooLong } = await import("../packages/contract/src/helpMeWrite.ts");

describe("writeTooLong (RV-hmw-1)", () => {
  test("Summarize says summarize; a rewrite keeps its words", () => {
    assert.match(writeTooLong("summarize"), /too much text to summarize/);
    assert.equal(writeTooLong("improve"), WRITE_TOO_LONG);
  });
});

describe("writeCursorMark (GW19)", () => {
  test("is WRITE_CURSOR with capital letters after it, new each time", () => {
    const mark = writeCursorMark();
    assert.match(mark, new RegExp(`^${WRITE_CURSOR}[A-Z]{10}$`));
    assert.notEqual(writeCursorMark(), mark);
  });
});

describe("replacesAll (GW8)", () => {
  test("Rewrite description replaces a description that has text", () => {
    assert.equal(replacesAll("task", "describe", true), true);
    assert.equal(replacesAll("project", "describe", true), true);
  });
  test("an empty description, a doc or another action is inserted as before", () => {
    assert.equal(replacesAll("task", "describe", false), false);
    assert.equal(replacesAll("doc", "describe", true), false);
    assert.equal(replacesAll("task", "write", true), false);
  });
});
