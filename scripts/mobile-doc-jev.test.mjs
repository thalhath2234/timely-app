import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { DOC_EDITOR_HELPERS_JS, mentionChoices } from "../apps/mobile/lib/docEditorJev.ts";

// The same source the phone's doc editor WebView runs.
const { propertyText, mentionSpaceAfter } = new Function(`${DOC_EDITOR_HELPERS_JS}; return { propertyText, mentionSpaceAfter };`)();

describe("propertyText", () => {
  test("starts a block when there is none", () => {
    assert.equal(propertyText("", "status", "draft"), "status: draft");
    assert.equal(propertyText("  \n", "status", "draft"), "status: draft");
  });

  test("replaces the key's line, ignoring case", () => {
    assert.equal(propertyText("title: Plan\nStatus: idea\nowner: Sam", "status", "draft"), "title: Plan\nstatus: draft\nowner: Sam");
  });

  test("adds a missing key at the end", () => {
    assert.equal(propertyText("title: Plan", "type", "spec"), "title: Plan\ntype: spec");
  });

  test("never replaces a nested key or a list line", () => {
    const nested = "title: Plan\nreview:\n  status: open\ntags:\n  - status: x\n- status: y";
    assert.equal(propertyText(nested, "status", "draft"), nested + "\nstatus: draft");
    assert.equal(propertyText("# status: note\ntitle: Plan", "status", "draft"), "# status: note\ntitle: Plan\nstatus: draft");
  });

  test("replaces a top-level key with its nested value", () => {
    assert.equal(propertyText("status:\n  - idea\n  - open\nowner: Sam", "status", "draft"), "status: draft\nowner: Sam");
    assert.equal(propertyText("status:\n- idea\nowner: Sam", "status", "draft"), "status: draft\nowner: Sam");
    assert.equal(propertyText("title: Plan\nstatus: idea\n\nowner: Sam", "status", "draft"), "title: Plan\nstatus: draft\n\nowner: Sam");
  });

  test("does not match a key that only starts the same", () => {
    assert.equal(propertyText("statuses: a", "status", "draft"), "statuses: a\nstatus: draft");
    assert.equal(propertyText("status:draft-ish", "status", "draft"), "status:draft-ish\nstatus: draft");
  });
});

describe("mentionSpaceAfter", () => {
  test("adds a space before a word or at the end", () => {
    assert.equal(mentionSpaceAfter(""), true);
    assert.equal(mentionSpaceAfter("a"), true);
    assert.equal(mentionSpaceAfter("7"), true);
    assert.equal(mentionSpaceAfter("é"), true);
  });

  test("adds none before a space or punctuation", () => {
    assert.equal(mentionSpaceAfter(" "), false);
    assert.equal(mentionSpaceAfter("."), false);
    assert.equal(mentionSpaceAfter(","), false);
  });
});

describe("mentionChoices", () => {
  const a = { kind: "task", id: "1", title: "Budget" };
  const b = { kind: "doc", id: "2", title: "Budget notes" };
  const c = { kind: "project", id: "3", title: "Q4" };

  test("puts Jev's pick first without repeating it", () => {
    const rows = mentionChoices({ available: true, match: b, options: [a, b, c] });
    assert.deepEqual(rows, [
      { target: b, best: true },
      { target: a, best: false },
      { target: c, best: false },
    ]);
  });

  test("lists the close items when Jev is not sure", () => {
    assert.deepEqual(mentionChoices({ available: true, options: [a, c] }), [
      { target: a, best: false },
      { target: c, best: false },
    ]);
  });

  test("keeps an item of another kind with the same id", () => {
    const sameId = { kind: "sheet", id: "2", title: "Budget sheet" };
    assert.equal(mentionChoices({ available: true, match: b, options: [b, sameId] }).length, 2);
  });

  test("is empty with no answer", () => {
    assert.deepEqual(mentionChoices(null), []);
    assert.deepEqual(mentionChoices({ available: false, options: [] }), []);
  });
});
