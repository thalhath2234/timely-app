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
