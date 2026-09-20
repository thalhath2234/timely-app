import type { SheetMerge } from "@/app/_types/types";

export interface CellAddress {
  col: number;
  row: number;
}

export interface CellRange {
  anchor: CellAddress;
  focus: CellAddress;
}

export function sameAddress(a: CellAddress, b: CellAddress) {
  return a.col === b.col && a.row === b.row;
}

export function sameRange(a: CellRange, b: CellRange) {
  const left = normalizedRange(a);
  const right = normalizedRange(b);
  return (
    left.minCol === right.minCol &&
    left.maxCol === right.maxCol &&
    left.minRow === right.minRow &&
    left.maxRow === right.maxRow
  );
}

export function clampAddress(
  address: CellAddress,
  colCount: number,
  rowCount: number,
): CellAddress {
  return {
    col: Math.min(Math.max(address.col, 0), Math.max(colCount - 1, 0)),
    row: Math.min(Math.max(address.row, 0), Math.max(rowCount - 1, 0)),
  };
}

export function normalizedRange(range: CellRange) {
  return {
    minCol: Math.min(range.anchor.col, range.focus.col),
    maxCol: Math.max(range.anchor.col, range.focus.col),
    minRow: Math.min(range.anchor.row, range.focus.row),
    maxRow: Math.max(range.anchor.row, range.focus.row),
  };
}

export function rangeAddressLabel(range: CellRange) {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  const start = `${colLetter(minCol)}${minRow + 1}`;
  if (minCol === maxCol && minRow === maxRow) return start;
  return `${start}:${colLetter(maxCol)}${maxRow + 1}`;
}

/** Cell below/right of a range so SUM does not overwrite (and cycle) its inputs. */
export function formulaOutputAddress(
  range: CellRange,
  colCount: number,
  rowCount: number,
): CellAddress {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  if (maxRow + 1 < rowCount) return { col: minCol, row: maxRow + 1 };
  if (maxCol + 1 < colCount) return { col: maxCol + 1, row: minRow };
  return { col: minCol, row: maxRow };
}

function colLetter(index: number) {
  let result = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

export function isInRange(address: CellAddress, range: CellRange) {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  return (
    address.col >= minCol &&
    address.col <= maxCol &&
    address.row >= minRow &&
    address.row <= maxRow
  );
}

export function isInAnyRange(address: CellAddress, ranges: CellRange[]) {
  return ranges.some((range) => isInRange(address, range));
}

export function rangeTouchesCol(range: CellRange, col: number) {
  const bounds = normalizedRange(range);
  return col >= bounds.minCol && col <= bounds.maxCol;
}

export function rangeTouchesRow(range: CellRange, row: number) {
  const bounds = normalizedRange(range);
  return row >= bounds.minRow && row <= bounds.maxRow;
}

export function visitRange(
  range: CellRange,
  visit: (address: CellAddress) => void,
) {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      visit({ col, row });
    }
  }
}

export function rangeFromMerge(merge: SheetMerge): CellRange {
  return {
    anchor: { col: merge.startCol, row: merge.startRow },
    focus: {
      col: merge.startCol + merge.colSpan - 1,
      row: merge.startRow + merge.rowSpan - 1,
    },
  };
}

export function mergeFromRange(range: CellRange): SheetMerge {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  return {
    startCol: minCol,
    startRow: minRow,
    colSpan: maxCol - minCol + 1,
    rowSpan: maxRow - minRow + 1,
  };
}

export function findMerge(merges: SheetMerge[], address: CellAddress) {
  return (
    merges.find(
      (merge) =>
        address.col >= merge.startCol &&
        address.col < merge.startCol + merge.colSpan &&
        address.row >= merge.startRow &&
        address.row < merge.startRow + merge.rowSpan,
    ) ?? null
  );
}

export function isMergeOrigin(merge: SheetMerge, address: CellAddress) {
  return merge.startCol === address.col && merge.startRow === address.row;
}

export function coveredByMerge(merges: SheetMerge[], address: CellAddress) {
  const merge = findMerge(merges, address);
  return Boolean(merge && !isMergeOrigin(merge, address));
}

export function isExactMergeSelection(range: CellRange, merge: SheetMerge) {
  return sameRange(range, rangeFromMerge(merge));
}

export function activeCellInRange(range: CellRange, merges: SheetMerge[]): CellAddress {
  const merge = findMerge(merges, range.focus);
  if (!merge) return range.focus;
  if (isExactMergeSelection(range, merge) || !isMergeOrigin(merge, range.focus)) {
    return { col: merge.startCol, row: merge.startRow };
  }
  return range.focus;
}

export function selectionAddressLabel(range: CellRange, merges: SheetMerge[] = []) {
  const merge = findMerge(merges, range.anchor);
  if (merge && isExactMergeSelection(range, merge)) {
    return rangeAddressLabel({
      anchor: { col: merge.startCol, row: merge.startRow },
      focus: { col: merge.startCol, row: merge.startRow },
    });
  }
  return rangeAddressLabel(range);
}

export function rangesOverlap(a: CellRange, b: CellRange) {
  const left = normalizedRange(a);
  const right = normalizedRange(b);
  return !(
    left.maxCol < right.minCol ||
    right.maxCol < left.minCol ||
    left.maxRow < right.minRow ||
    right.maxRow < left.minRow
  );
}

export function unmergeRange(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  return merges.filter((merge) => !rangesOverlap(rangeFromMerge(merge), range));
}

export function addMerge(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  const next = mergeFromRange(range);
  if (next.colSpan === 1 && next.rowSpan === 1) return merges;
  return [...unmergeRange(merges, range), next];
}

export function mergeAll(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  return addMerge(merges, range);
}

export function mergeHorizontally(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  if (maxCol === minCol) return merges;
  let next = unmergeRange(merges, range);
  for (let row = minRow; row <= maxRow; row += 1) {
    next = addMerge(next, {
      anchor: { col: minCol, row },
      focus: { col: maxCol, row },
    });
  }
  return next;
}

export function mergeVertically(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
  if (maxRow === minRow) return merges;
  let next = unmergeRange(merges, range);
  for (let col = minCol; col <= maxCol; col += 1) {
    next = addMerge(next, {
      anchor: { col, row: minRow },
      focus: { col, row: maxRow },
    });
  }
  return next;
}

export function hasMergeInRange(merges: SheetMerge[], range: CellRange) {
  return merges.some((merge) => rangesOverlap(rangeFromMerge(merge), range));
}

/** Nearby numeric block for SUM/AVERAGE, matching Sheets (row above, then column above, then left). */
export function guessAggregateRange(
  origin: CellAddress,
  colCount: number,
  rowCount: number,
  isNumeric: (address: CellAddress) => boolean,
): CellRange | null {
  const expandHorizontal = (row: number, aroundCol: number): CellRange | null => {
    let seed = -1;
    if (aroundCol >= 0 && aroundCol < colCount && isNumeric({ col: aroundCol, row })) {
      seed = aroundCol;
    } else {
      for (let col = aroundCol - 1; col >= 0; col -= 1) {
        if (isNumeric({ col, row })) {
          seed = col;
          break;
        }
      }
      if (seed < 0) {
        for (let col = aroundCol + 1; col < colCount; col += 1) {
          if (isNumeric({ col, row })) {
            seed = col;
            break;
          }
        }
      }
    }
    if (seed < 0) return null;
    let minCol = seed;
    let maxCol = seed;
    while (minCol > 0 && isNumeric({ col: minCol - 1, row })) minCol -= 1;
    while (maxCol < colCount - 1 && isNumeric({ col: maxCol + 1, row })) maxCol += 1;
    return { anchor: { col: minCol, row }, focus: { col: maxCol, row } };
  };

  const expandVertical = (col: number, aroundRow: number): CellRange | null => {
    let seed = -1;
    if (aroundRow >= 0 && aroundRow < rowCount && isNumeric({ col, row: aroundRow })) {
      seed = aroundRow;
    } else {
      for (let row = aroundRow; row >= 0; row -= 1) {
        if (isNumeric({ col, row })) {
          seed = row;
          break;
        }
      }
    }
    if (seed < 0) return null;
    let minRow = seed;
    let maxRow = seed;
    while (minRow > 0 && isNumeric({ col, row: minRow - 1 })) minRow -= 1;
    while (maxRow < rowCount - 1 && isNumeric({ col, row: maxRow + 1 })) maxRow += 1;
    if (maxRow < aroundRow) maxRow = aroundRow;
    return { anchor: { col, row: minRow }, focus: { col, row: maxRow } };
  };

  if (origin.row > 0) {
    const aboveRow = expandHorizontal(origin.row - 1, origin.col);
    if (aboveRow) return aboveRow;
    const aboveCol = expandVertical(origin.col, origin.row - 1);
    if (aboveCol) return aboveCol;
  }
  if (origin.col > 0) {
    const left = expandHorizontal(origin.row, origin.col - 1);
    if (left) return left;
  }
  return null;
}

export function toggleMerge(merges: SheetMerge[], range: CellRange): SheetMerge[] {
  const next = mergeFromRange(range);
  if (next.colSpan === 1 && next.rowSpan === 1) return merges;
  const existing = merges.find(
    (merge) =>
      merge.startCol === next.startCol &&
      merge.startRow === next.startRow &&
      merge.colSpan === next.colSpan &&
      merge.rowSpan === next.rowSpan,
  );
  if (existing) {
    return merges.filter((merge) => merge !== existing);
  }
  return addMerge(merges, range);
}

export function selectionStats(
  range: CellRange,
  valueAt: (address: CellAddress) => number | null,
  isEmpty: (address: CellAddress) => boolean,
) {
  let count = 0;
  let sum = 0;
  let numeric = 0;
  visitRange(range, (address) => {
    if (!isEmpty(address)) count += 1;
    const value = valueAt(address);
    if (value == null) return;
    sum += value;
    numeric += 1;
  });
  return {
    count,
    sum,
    average: numeric > 0 ? sum / numeric : null,
  };
}
