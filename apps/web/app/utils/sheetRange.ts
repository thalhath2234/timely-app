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
  return [
    ...merges.filter((merge) => {
      const other = rangeFromMerge(merge);
      const a = normalizedRange(range);
      const b = normalizedRange(other);
      return (
        a.maxCol < b.minCol ||
        b.maxCol < a.minCol ||
        a.maxRow < b.minRow ||
        b.maxRow < a.minRow
      );
    }),
    next,
  ];
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
