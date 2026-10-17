import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { dropIndex, moveItem, slotTop } from "../apps/mobile/lib/dashboardReorder.ts";

// Five 52px rows, 12px apart, starting at 0.
const rows = [0, 1, 2, 3, 4].map((index) => ({ y: index * 64, h: 52 }));
const gap = 12;

describe("dropIndex", () => {
  test("stays put when the row has not moved", () => {
    for (let from = 0; from < rows.length; from += 1) assert.equal(dropIndex(rows, from, rows[from].y, gap), from);
  });

  test("swaps once the row is past halfway to the next slot", () => {
    assert.equal(dropIndex(rows, 0, 31, gap), 0);
    assert.equal(dropIndex(rows, 0, 33, gap), 1);
    assert.equal(dropIndex(rows, 2, 128 - 33, gap), 1);
    assert.equal(dropIndex(rows, 2, 128 - 31, gap), 2);
  });

  test("lands on exactly the slot it was dragged to", () => {
    assert.equal(dropIndex(rows, 0, 4 * 64, gap), 4);
    assert.equal(dropIndex(rows, 4, 0, gap), 0);
    assert.equal(dropIndex(rows, 1, 3 * 64, gap), 3);
  });

  test("clamps past either end of the list", () => {
    assert.equal(dropIndex(rows, 2, -500, gap), 0);
    assert.equal(dropIndex(rows, 2, 5000, gap), 4);
  });

  test("works with rows of different heights", () => {
    const mixed = [
      { y: 0, h: 52 },
      { y: 64, h: 80 },
      { y: 156, h: 52 },
    ];
    assert.equal(dropIndex(mixed, 0, 0, gap), 0);
    // Moving below the 80px row is a 92px step; the row gives way halfway, at 46px.
    assert.equal(dropIndex(mixed, 0, 44, gap), 0);
    assert.equal(dropIndex(mixed, 0, 48, gap), 1);
  });
});

describe("slotTop", () => {
  test("is the row's own top when it goes back where it came from", () => {
    for (let from = 0; from < rows.length; from += 1) assert.equal(slotTop(rows, from, from, gap), rows[from].y);
  });

  test("is where the row will sit after the move", () => {
    assert.equal(slotTop(rows, 0, 4, gap), 4 * 64);
    assert.equal(slotTop(rows, 4, 0, gap), 0);
    assert.equal(slotTop(rows, 3, 1, gap), 64);
  });
});

describe("moveItem", () => {
  test("moves down and up", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  });

  test("returns a copy when nothing moves", () => {
    const list = ["a", "b"];
    const next = moveItem(list, 1, 1);
    assert.deepEqual(next, list);
    assert.notEqual(next, list);
  });
});
