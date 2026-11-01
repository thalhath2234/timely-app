import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { importLineKind, formatPlainText, linesToMarkdown, plainLines } from "../packages/contract/src/importFormat.ts";
import { RELATED_KEEP_MS, relatedRefetchInterval, relatedStaleTime, smartCreate } from "../packages/contract/src/smartSearch.ts";

describe("smartCreate", () => {
  test("a known kind with a title is offered, trimmed", () => {
    assert.deepEqual(smartCreate({ kind: "sheet", title: " Wedding budget " }), { kind: "sheet", title: "Wedding budget" });
    assert.deepEqual(smartCreate({ kind: "event", title: "Dentist" }), { kind: "event", title: "Dentist" });
  });
  test("an unknown kind is not offered", () => {
    // It read "Create undefined “Folder for taxes”", and choosing it did nothing.
    assert.equal(smartCreate({ kind: "folder", title: "Folder for taxes" }), undefined);
    assert.equal(smartCreate({ kind: "toString", title: "x" }), undefined);
    assert.equal(smartCreate({ kind: ["doc"], title: "x" }), undefined);
  });
  test("no title or no offer is nothing", () => {
    assert.equal(smartCreate({ kind: "doc", title: "  " }), undefined);
    assert.equal(smartCreate({ kind: "doc" }), undefined);
    assert.equal(smartCreate(null), undefined);
    assert.equal(smartCreate(undefined), undefined);
    assert.equal(smartCreate("doc"), undefined);
  });
});

describe("Related list freshness", () => {
  test("a found list is kept ten minutes, an empty one is not kept", () => {
    assert.equal(relatedStaleTime({ data: [{ id: "a" }] }), RELATED_KEEP_MS);
    assert.equal(relatedStaleTime({ data: [] }), 0);
    assert.equal(relatedStaleTime({}), 0);
  });
  test("an empty list is asked again three times after the first answer", () => {
    // The doc opened 3 s after it was made answered []; the same call 25 s
    // later found five items.
    assert.equal(relatedRefetchInterval({ data: undefined, dataUpdateCount: 0 }), false);
    const asks = [1, 2, 3, 4].map((n) => relatedRefetchInterval({ data: [], dataUpdateCount: n }));
    assert.deepEqual(asks, [10_000, 10_000, 10_000, false]);
    assert.equal(relatedRefetchInterval({ data: [{ id: "a" }], dataUpdateCount: 1 }), false);
  });
});

describe("import line kinds", () => {
  const lines = plainLines("Shopping\n\neggs\nmilk");
  test("an unknown kind imports as a paragraph", () => {
    // "title" used to import as "undefinedShopping".
    assert.equal(linesToMarkdown(lines, ["title", "bullet", "bullet"]), "Shopping\n\n- eggs\n- milk");
    assert.equal(importLineKind("title"), "paragraph");
    assert.equal(importLineKind("constructor"), "paragraph");
    assert.equal(importLineKind(undefined), "paragraph");
    assert.equal(importLineKind("heading"), "heading");
  });
  test("an answer of only unknown and paragraph kinds leaves the text as it was", async () => {
    const source = "Shopping\n\neggs\nmilk";
    assert.equal(await formatPlainText(source, async () => ({ available: true, kinds: ["title", "paragraph", "other"] })), source);
    assert.equal(await formatPlainText(source, async () => ({ available: true, kinds: ["heading", "bullet", "bullet"] })), "## Shopping\n\n- eggs\n- milk");
  });
});
