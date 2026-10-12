import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { indexAtScreen, pinnedColumnWidths, pinnedRowCount, screenStart } from "../apps/mobile/lib/sheetFreeze.ts";

describe("pinnedColumnWidths", () => {
  test("keeps widths that already fit", () => {
    assert.deepEqual(pinnedColumnWidths([112, 140, 90], 1, 196, 82), [112]);
  });

  test("narrows Date and Item on a 390px phone instead of covering the screen", () => {
    // Yearly expenses month tabs freeze Date (112) and Item (200).
    const widths = pinnedColumnWidths([112, 200, 150], 2, 390 * 0.6 - 38, 82);
    assert.equal(widths.length, 2);
    assert.ok(widths.every((width) => width >= 82));
    assert.ok(widths[0] + widths[1] <= 390 * 0.6 - 38);
    assert.deepEqual(widths, [98, 98]);
  });

  test("narrows the widest column first", () => {
    assert.deepEqual(pinnedColumnWidths([90, 200], 2, 196, 82), [90, 106]);
  });

  test("pins fewer columns when even the narrowest widths do not fit", () => {
    assert.deepEqual(pinnedColumnWidths([140, 140, 140], 3, 200, 82), [100, 100]);
    assert.deepEqual(pinnedColumnWidths([140], 1, 60, 82), []);
  });

  test("hidden columns stay pinned at no width", () => {
    assert.deepEqual(pinnedColumnWidths([0, 120], 2, 196, 82), [0, 120]);
  });

  test("nothing frozen pins nothing", () => {
    assert.deepEqual(pinnedColumnWidths([120, 120], 0, 196, 82), []);
  });
});

describe("pinnedRowCount", () => {
  test("pins the frozen rows that fit in half the grid", () => {
    assert.equal(pinnedRowCount(1, 40, 400, 34, 32), 1);
    assert.equal(pinnedRowCount(10, 40, 400, 34, 32), 5);
  });

  test("never pins more rows than the tab has", () => {
    assert.equal(pinnedRowCount(3, 2, 800, 34, 32), 2);
  });
});

describe("touch mapping with pinned cells", () => {
  const axis = (scroll) => ({ lead: 38, sizeAt: () => 100, pinned: 2, scroll });

  test("pinned cells don't move with the scroll; the rest do", () => {
    assert.equal(screenStart(axis(250), 1), 138);
    assert.equal(screenStart(axis(250), 4), 438 - 250);
  });

  test("a point over the pinned columns hits them, past them hits the scrolled ones", () => {
    assert.equal(indexAtScreen(axis(250), 150, 20), 1);
    // 260 on screen is 510 in the grid: column 4 starts at 438.
    assert.equal(indexAtScreen(axis(250), 260, 20), 4);
    assert.equal(indexAtScreen(axis(0), 260, 20), 2);
  });

  test("dragging from a pinned cell into the scrolled part lands under the finger", () => {
    const start = screenStart(axis(300), 0) + 40;
    assert.equal(indexAtScreen(axis(300), start + 200, 20), 5);
  });

  test("stops at the last index", () => {
    assert.equal(indexAtScreen(axis(0), 5000, 6), 6);
  });
});
