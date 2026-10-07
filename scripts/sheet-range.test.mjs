import assert from "node:assert/strict";
import test, { describe } from "node:test";
import * as range from "../packages/contract/src/sheetRange.ts";

const r = (c1, r1, c2 = c1, r2 = r1) => ({
  anchor: { col: c1, row: r1 },
  focus: { col: c2, row: r2 },
});

describe("sheetRange", () => {
  test("normalizedRange orders reversed selections", () => {
    assert.deepEqual(range.normalizedRange(r(3, 4, 1, 2)), {
      minCol: 1,
      maxCol: 3,
      minRow: 2,
      maxRow: 4,
    });
  });

  test("address labels", () => {
    assert.equal(range.rangeAddressLabel(r(0, 0)), "A1");
    assert.equal(range.rangeAddressLabel(r(2, 4, 0, 1)), "A2:C5");
    assert.equal(range.rangeAddressLabel(r(26, 0)), "AA1");
  });

  test("clampAddress stays inside the grid", () => {
    assert.deepEqual(range.clampAddress({ col: -2, row: 99 }, 3, 5), {
      col: 0,
      row: 4,
    });
    assert.deepEqual(range.clampAddress({ col: 1, row: 1 }, 0, 0), {
      col: 0,
      row: 0,
    });
  });

  test("formulaOutputAddress prefers below, then right, then in place", () => {
    assert.deepEqual(range.formulaOutputAddress(r(1, 0, 1, 2), 3, 5), {
      col: 1,
      row: 3,
    });
    assert.deepEqual(range.formulaOutputAddress(r(1, 0, 1, 4), 3, 5), {
      col: 2,
      row: 0,
    });
    assert.deepEqual(range.formulaOutputAddress(r(1, 0, 2, 4), 3, 5), {
      col: 1,
      row: 4,
    });
  });

  test("containment and overlap", () => {
    assert.equal(range.isInRange({ col: 1, row: 1 }, r(0, 0, 2, 2)), true);
    assert.equal(range.isInRange({ col: 3, row: 1 }, r(0, 0, 2, 2)), false);
    assert.equal(
      range.isInAnyRange({ col: 5, row: 5 }, [r(0, 0), r(5, 5)]),
      true,
    );
    assert.equal(range.rangesOverlap(r(0, 0, 1, 1), r(1, 1, 2, 2)), true);
    assert.equal(range.rangesOverlap(r(0, 0, 1, 1), r(2, 2, 3, 3)), false);
    assert.equal(range.rangeTouchesCol(r(1, 0, 3, 0), 2), true);
    assert.equal(range.rangeTouchesRow(r(0, 1, 0, 3), 4), false);
  });

  test("visitRange walks row by row", () => {
    const seen = [];
    range.visitRange(r(1, 0, 0, 1), (a) => seen.push(`${a.col},${a.row}`));
    assert.deepEqual(seen, ["0,0", "1,0", "0,1", "1,1"]);
  });

  test("merge <-> range round trip", () => {
    const merge = range.mergeFromRange(r(2, 3, 1, 1));
    assert.deepEqual(merge, {
      startCol: 1,
      startRow: 1,
      colSpan: 2,
      rowSpan: 3,
    });
    assert.deepEqual(range.normalizedRange(range.rangeFromMerge(merge)), {
      minCol: 1,
      maxCol: 2,
      minRow: 1,
      maxRow: 3,
    });
  });

  test("addMerge ignores single cells and replaces overlapping merges", () => {
    assert.deepEqual(range.addMerge([], r(1, 1)), []);
    const first = range.addMerge([], r(0, 0, 1, 1));
    const second = range.addMerge(first, r(1, 1, 2, 2));
    assert.equal(second.length, 1);
    assert.deepEqual(second[0], {
      startCol: 1,
      startRow: 1,
      colSpan: 2,
      rowSpan: 2,
    });
  });

  test("toggleMerge removes an exact merge and adds otherwise", () => {
    const merged = range.toggleMerge([], r(0, 0, 1, 0));
    assert.equal(merged.length, 1);
    assert.deepEqual(range.toggleMerge(merged, r(0, 0, 1, 0)), []);
    assert.equal(range.toggleMerge(merged, r(0, 0, 2, 0)).length, 1);
  });

  test("mergeHorizontally and mergeVertically make one merge per line", () => {
    const horizontal = range.mergeHorizontally([], r(0, 0, 2, 1));
    assert.deepEqual(horizontal, [
      { startCol: 0, startRow: 0, colSpan: 3, rowSpan: 1 },
      { startCol: 0, startRow: 1, colSpan: 3, rowSpan: 1 },
    ]);
    const vertical = range.mergeVertically([], r(0, 0, 1, 2));
    assert.deepEqual(vertical, [
      { startCol: 0, startRow: 0, colSpan: 1, rowSpan: 3 },
      { startCol: 1, startRow: 0, colSpan: 1, rowSpan: 3 },
    ]);
    assert.deepEqual(range.mergeHorizontally([], r(1, 0, 1, 3)), []);
  });

  test("findMerge, coveredByMerge and isMergeOrigin", () => {
    const merges = [{ startCol: 1, startRow: 1, colSpan: 2, rowSpan: 2 }];
    assert.equal(range.findMerge(merges, { col: 2, row: 2 }), merges[0]);
    assert.equal(range.coveredByMerge(merges, { col: 2, row: 2 }), true);
    assert.equal(range.coveredByMerge(merges, { col: 1, row: 1 }), false);
    assert.equal(range.isMergeOrigin(merges[0], { col: 1, row: 1 }), true);
    assert.equal(range.hasMergeInRange(merges, r(0, 0, 1, 1)), true);
    assert.equal(range.hasMergeInRange(merges, r(0, 0)), false);
    assert.equal(range.unmergeRange(merges, r(2, 2)).length, 0);
  });

  test("guessAggregateRange follows the numeric block above", () => {
    const numeric = new Set(["0,0", "1,0", "2,0"]);
    const isNumeric = (a) => numeric.has(`${a.col},${a.row}`);
    assert.deepEqual(
      range.guessAggregateRange({ col: 1, row: 1 }, 4, 3, isNumeric),
      r(0, 0, 2, 0),
    );
    assert.equal(
      range.guessAggregateRange({ col: 1, row: 0 }, 4, 3, () => false),
      null,
    );
  });

  test("selectionStats", () => {
    const values = { "0,0": 2, "1,0": 4, "0,1": null };
    const key = (a) => `${a.col},${a.row}`;
    const stats = range.selectionStats(
      r(0, 0, 1, 1),
      (a) => values[key(a)] ?? null,
      (a) => key(a) === "1,1",
    );
    assert.deepEqual(stats, { count: 3, sum: 6, average: 3 });
    assert.equal(
      range.selectionStats(
        r(0, 0),
        () => null,
        () => true,
      ).average,
      null,
    );
  });
});
