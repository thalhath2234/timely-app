import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { createScrollRest, indexAtScreen, pinnedColumnWidths, pinnedRowCount, screenStart } from "../apps/mobile/lib/sheetFreeze.ts";

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

describe("where the grid comes to rest", () => {
  // A hand-wound clock: `run()` fires whatever timer is pending.
  const clock = () => {
    let pending = null;
    return {
      timers: { set: (fn) => (pending = fn), clear: () => (pending = null) },
      run: () => {
        const fn = pending;
        pending = null;
        fn?.();
      },
      waiting: () => pending != null,
    };
  };

  test("tracks every offset live but only rests once the scroll goes quiet", () => {
    const time = clock();
    const rest = createScrollRest(80, time.timers);
    let heard = 0;
    rest.subscribe(() => (heard += 1));
    rest.scrolled("y", 120);
    rest.scrolled("y", 260);
    rest.scrolled("x", 90);
    assert.deepEqual(rest.live(), { x: 90, y: 260 });
    assert.deepEqual(rest.rest(), { x: 0, y: 0 });
    assert.equal(heard, 0);
    time.run();
    assert.deepEqual(rest.rest(), { x: 90, y: 260 });
    assert.equal(heard, 1);
  });

  test("each scroll event pushes the stop back", () => {
    const time = clock();
    const rest = createScrollRest(80, time.timers);
    rest.scrolled("y", 40);
    rest.scrolled("y", 80);
    // Only one timer is ever pending: the earlier one was cleared.
    assert.equal(time.waiting(), true);
    time.run();
    assert.equal(time.waiting(), false);
    assert.equal(rest.rest().y, 80);
  });

  test("overscroll past the start counts as no scroll", () => {
    const time = clock();
    const rest = createScrollRest(80, time.timers);
    rest.scrolled("x", -24);
    assert.equal(rest.live().x, 0);
    assert.equal(time.waiting(), false);
  });

  test("keeps the same snapshot while nothing moves, so React doesn't re-render", () => {
    const time = clock();
    const rest = createScrollRest(80, time.timers);
    rest.scrolled("y", 64);
    time.run();
    const first = rest.rest();
    rest.scrolled("y", 64);
    assert.equal(time.waiting(), false);
    assert.equal(rest.rest(), first);
  });

  test("a stop that lands back where it was tells nobody", () => {
    const time = clock();
    const rest = createScrollRest(80, time.timers);
    let heard = 0;
    rest.subscribe(() => (heard += 1));
    rest.scrolled("y", 64);
    rest.scrolled("y", 0);
    time.run();
    assert.equal(heard, 0);
  });
});

// The pinned layers must move on the native driver. Reanimated styles reach
// the screen through a commit of React's tree, and Reanimated holds those
// commits while React's own commit is in flight (every tap on a cell starts
// one), so the pinned rows and columns rode along with the scroll and then
// snapped back: the flicker reported on Android.
test("the phone grid slides its pinned layers on the native driver", () => {
  const grid = readFileSync(new URL("../apps/mobile/components/sheets/SheetGrid.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(grid, /react-native-reanimated/);
  assert.equal(grid.match(/Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ [xy] \} \} \}\], \{ useNativeDriver: true/g)?.length, 2);
  assert.equal(grid.match(/onScroll=\{scroll\.onScroll[XY]\}/g)?.length, 2);
  assert.equal(grid.match(/<SheetPinLayer /g)?.length, 3);
});
