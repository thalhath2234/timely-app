// Frozen rows and columns on the phone. The grid draws them in layers that
// slide with the scroll offset, so these helpers decide how much fits on a
// small screen and map touches back to cells while part of the grid is pinned.

/**
 * Widths of the columns that stay pinned, given every column's normal width
 * (0 for hidden ones). Pinned columns share at most `budget` pixels so the
 * rest of the sheet still has room to scroll: the widest ones are narrowed
 * first (never below `minWidth`), and when even that does not fit, fewer
 * columns are pinned.
 */
export function pinnedColumnWidths(widths: number[], want: number, budget: number, minWidth: number): number[] {
  for (let count = Math.min(Math.max(want, 0), widths.length); count > 0; count -= 1) {
    const slice = widths.slice(0, count);
    const total = slice.reduce((sum, width) => sum + width, 0);
    if (total <= budget) return slice;
    const shown = slice.filter((width) => width > 0).length;
    if (shown * minWidth > budget) continue;
    // Lower a common ceiling until the columns fit: narrow ones keep their
    // width and only the ones above the ceiling give up room.
    let ceiling = Math.max(...slice);
    const fitted = (cap: number) => slice.reduce((sum, width) => sum + Math.min(width, cap), 0);
    while (ceiling > minWidth && fitted(ceiling) > budget) ceiling -= 1;
    return slice.map((width) => Math.min(width, ceiling));
  }
  return [];
}

/** How many of the frozen rows stay pinned: at most `share` of the grid's height, header included. */
export function pinnedRowCount(want: number, rowCount: number, viewportHeight: number, headerHeight: number, rowHeight: number, share = 0.5) {
  const room = Math.floor((viewportHeight * share - headerHeight) / rowHeight);
  return Math.max(0, Math.min(want, rowCount, room));
}

export type PinnedAxis = {
  /** Size of the row-number column (or the header row) before the first cell. */
  lead: number;
  sizeAt: (index: number) => number;
  /** How many leading cells stay in place while the rest scroll. */
  pinned: number;
  scroll: number;
};

/** Where a cell starts on screen, measured from the grid's left (or top) edge. */
export function screenStart(axis: PinnedAxis, index: number) {
  let start = axis.lead;
  for (let i = 0; i < index; i += 1) start += axis.sizeAt(i);
  return index < axis.pinned ? start : start - axis.scroll;
}

/** The cell under a point on screen. Points over the pinned cells hit those;
 * anything past them hits the scrolled part of the grid. */
export function indexAtScreen(axis: PinnedAxis, point: number, maxIndex: number) {
  let pinnedEnd = axis.lead;
  for (let i = 0; i < axis.pinned; i += 1) pinnedEnd += axis.sizeAt(i);
  const content = point < pinnedEnd ? point : point + axis.scroll;
  let index = 0;
  let edge = axis.lead;
  while (index < maxIndex) {
    const size = axis.sizeAt(index);
    if (content < edge + size) break;
    edge += size;
    index += 1;
  }
  return index;
}

export type ScrollOffset = { x: number; y: number };

/**
 * The grid's scroll offsets, for the pinned layers. On a phone the layers
 * slide on the native animation driver, which React never hears about, so
 * `live` keeps the latest offset (for mapping touches, and for moving the
 * layers on the web, which has no native driver) and `rest` is where the grid
 * last came to a stop: once the scroll has been quiet for `quietMs`,
 * subscribers hear about it and hand the offset to React too.
 */
export function createScrollRest(
  quietMs = 80,
  timers: { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
) {
  let live: ScrollOffset = { x: 0, y: 0 };
  let rest: ScrollOffset = live;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const watchers = new Set<() => void>();
  const settle = () => {
    timer = null;
    if (live.x === rest.x && live.y === rest.y) return;
    rest = live;
    for (const listener of listeners) listener();
  };
  return {
    live: () => live,
    rest: () => rest,
    /** Records a scroll event's offset; overscroll past the start counts as 0. */
    scrolled(axis: keyof ScrollOffset, offset: number) {
      const next = Math.max(0, offset);
      if (next === live[axis]) return;
      live = { ...live, [axis]: next };
      for (const watcher of watchers) watcher();
      if (timer != null) timers.clear(timer);
      timer = timers.set(settle, quietMs);
    },
    /** Hears every scroll event, while it is being handled. */
    watch(watcher: () => void) {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Drops a pending stop, for when the grid goes away. */
    dispose() {
      if (timer != null) timers.clear(timer);
      timer = null;
    },
  };
}

export type ScrollRest = ReturnType<typeof createScrollRest>;
