/**
 * Geometry for dragging a row to a new place in a vertical list (the phone
 * Dashboard's edit list). Rows are given in list order with their top and
 * height in the list's own coordinates; `gap` is the space between rows.
 */
export type RowBox = { y: number; h: number };

/** Each other row's top once the dragged row is lifted out and the list closes up. */
function closedUp(rows: RowBox[], from: number, gap: number) {
  const shift = rows[from].h + gap;
  return rows.flatMap((row, index) => (index === from ? [] : [{ y: index > from ? row.y - shift : row.y, h: row.h }]));
}

/**
 * The index the dragged row would land at when its top edge is at `top`.
 * A row gives way once the dragged row is more than halfway into the step
 * that would take it past that row. Measured on the closed-up list, so the
 * answer never depends on where the gap currently is and can't flicker.
 */
export function dropIndex(rows: RowBox[], from: number, top: number, gap: number) {
  if (from < 0 || from >= rows.length) return from;
  const dragged = rows[from];
  const centre = top + dragged.h / 2;
  const half = (dragged.h + gap) / 2;
  let index = 0;
  for (const row of closedUp(rows, from, gap)) {
    if (centre > row.y + row.h / 2 + half) index += 1;
    else break;
  }
  return index;
}

/** Where the top of the gap is when the dragged row is headed for `to`. */
export function slotTop(rows: RowBox[], from: number, to: number, gap: number) {
  const others = closedUp(rows, from, gap);
  if (to <= 0 || others.length === 0) return rows[0].y;
  const before = others[Math.min(to, others.length) - 1];
  return before.y + before.h + gap;
}

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from === to || from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
