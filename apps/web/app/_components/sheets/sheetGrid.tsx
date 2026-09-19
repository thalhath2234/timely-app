"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AlignCenter from "lucide-react/dist/esm/icons/align-center.mjs";
import AlignLeft from "lucide-react/dist/esm/icons/align-left.mjs";
import AlignRight from "lucide-react/dist/esm/icons/align-right.mjs";
import AlignVerticalJustifyCenter from "lucide-react/dist/esm/icons/align-vertical-justify-center.mjs";
import AlignVerticalJustifyEnd from "lucide-react/dist/esm/icons/align-vertical-justify-end.mjs";
import AlignVerticalJustifyStart from "lucide-react/dist/esm/icons/align-vertical-justify-start.mjs";
import ArrowDownAZ from "lucide-react/dist/esm/icons/arrow-down-a-z.mjs";
import ArrowUpAZ from "lucide-react/dist/esm/icons/arrow-up-a-z.mjs";
import BarChart3 from "lucide-react/dist/esm/icons/bar-chart-3.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import BetweenHorizontalEnd from "lucide-react/dist/esm/icons/between-horizontal-end.mjs";
import BetweenHorizontalStart from "lucide-react/dist/esm/icons/between-horizontal-start.mjs";
import BetweenVerticalEnd from "lucide-react/dist/esm/icons/between-vertical-end.mjs";
import BetweenVerticalStart from "lucide-react/dist/esm/icons/between-vertical-start.mjs";
import Bold from "lucide-react/dist/esm/icons/bold.mjs";
import ClipboardCopy from "lucide-react/dist/esm/icons/clipboard-copy.mjs";
import ClipboardPaste from "lucide-react/dist/esm/icons/clipboard-paste.mjs";
import Combine from "lucide-react/dist/esm/icons/combine.mjs";
import Filter from "lucide-react/dist/esm/icons/filter.mjs";
import Highlighter from "lucide-react/dist/esm/icons/highlighter.mjs";
import Italic from "lucide-react/dist/esm/icons/italic.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Minus from "lucide-react/dist/esm/icons/minus.mjs";
import Paintbrush from "lucide-react/dist/esm/icons/paintbrush.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Printer from "lucide-react/dist/esm/icons/printer.mjs";
import Redo2 from "lucide-react/dist/esm/icons/redo-2.mjs";
import Scissors from "lucide-react/dist/esm/icons/scissors.mjs";
import Sigma from "lucide-react/dist/esm/icons/sigma.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import Strikethrough from "lucide-react/dist/esm/icons/strikethrough.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import Type from "lucide-react/dist/esm/icons/type.mjs";
import Underline from "lucide-react/dist/esm/icons/underline.mjs";
import Undo2 from "lucide-react/dist/esm/icons/undo-2.mjs";
import WrapText from "lucide-react/dist/esm/icons/wrap-text.mjs";
import {
  SheetBorder,
  SheetCellFormat,
  SheetColumn,
  SheetColumnType,
  SheetFontFamily,
  SheetMerge,
  SheetNumberFormat,
  SheetRow,
  SheetVerticalAlign,
} from "@/app/_types/types";
import {
  columnIndexToLetter,
  createSheetEvaluator,
  shiftFormula,
} from "@/app/utils/sheetFormula";
import {
  isBooleanTrue,
  isFormulaValue,
  newColumnId,
  newRowId,
  normalizeTypedCell,
  setCellFormat,
  isEmptyCellFormat,
  SHEET_COLUMN_TYPES,
  toggleNumberFormat,
} from "@/app/utils/sheetColumns";
import {
  columnTypeBadge,
  cellFormatFontFamily,
  cellTextDecoration,
  defaultAlign,
  formatSheetDisplay,
  statusChip,
} from "@/app/utils/sheetDisplay";
import {
  CellAddress,
  CellRange,
  clampAddress,
  coveredByMerge,
  findMerge,
  formulaOutputAddress,
  guessAggregateRange,
  hasMergeInRange,
  isInRange,
  isMergeOrigin,
  mergeAll,
  mergeFromRange,
  mergeHorizontally,
  mergeVertically,
  normalizedRange,
  rangeAddressLabel,
  rangeFromMerge,
  sameAddress,
  selectionStats,
  unmergeRange,
  visitRange,
} from "@/app/utils/sheetRange";
import {
  closeOpenParens,
  insertFormulaRange,
  type FormulaRefSpan,
} from "@/app/utils/sheetFormulaInput";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 640;
const ROW_HEADER_WIDTH = 52;
const ROW_HEIGHT = 32;
const ZOOM_OPTIONS = [50, 75, 90, 100, 125, 150, 200];
const FONT_SIZES = [10, 11, 12, 14, 18, 24];
const TEXT_COLORS = ["#e8eaed", "#f28b82", "#fdd663", "#81c995", "#8ab4f8", "#c58af9", "#ff8bcb"];
const FILL_COLORS = ["#202124", "#5f2120", "#614a19", "#137333", "#174ea6", "#7627bb", "#3c4043"];
const FORMULA_INSERTS: { label: string; template: (range: string) => string }[] = [
  { label: "SUM", template: (range) => `=SUM(${range})` },
  { label: "AVERAGE", template: (range) => `=AVERAGE(${range})` },
  { label: "COUNT", template: (range) => `=COUNT(${range})` },
  { label: "MAX", template: (range) => `=MAX(${range})` },
  { label: "MIN", template: (range) => `=MIN(${range})` },
  { label: "COUNTA", template: (range) => `=COUNTA(${range})` },
  { label: "PRODUCT", template: (range) => `=PRODUCT(${range})` },
  { label: "IF", template: (range) => `=IF(${range || "A1"}>0,"yes","no")` },
  { label: "CONCAT", template: (range) => `=CONCAT(${range || "A1"},"")` },
  { label: "ROUND", template: (range) => `=ROUND(${range || "A1"},0)` },
];
const NUMBER_FORMATS: { value: SheetNumberFormat | ""; label: string }[] = [
  { value: "", label: "Automatic" },
  { value: "plain", label: "Plain text" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "scientific", label: "Scientific" },
  { value: "currency", label: "Currency" },
];
const ROTATIONS = [0, 45, -45, 90, -90];
const POPOVER_PANEL =
  "absolute z-40 rounded-md border border-border bg-popover p-1 shadow-lg";
const POPOVER_ITEM =
  "block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent";

type GridSnapshot = {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges: SheetMerge[];
};

export interface SheetTabItem {
  id: string;
  name: string;
}

export interface SheetGridProps {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
  onChange: (next: {
    columns?: SheetColumn[];
    rows?: SheetRow[];
    merges?: SheetMerge[];
  }) => void;
  tabs?: SheetTabItem[];
  activeTabId?: string;
  onSelectTab?: (id: string) => void;
  onAddTab?: () => void;
  onRenameTab?: (id: string, name: string) => void;
  onDeleteTab?: (id: string) => void;
}

function emptyRow(columns: SheetColumn[]): SheetRow {
  const cells: Record<string, string> = {};
  columns.forEach((column) => {
    cells[column.id] = "";
  });
  return { id: newRowId(), cells };
}

function formatAt(
  row: SheetRow | undefined,
  columnId: string,
): SheetCellFormat | undefined {
  return row?.formats?.[columnId];
}

function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (body === "") return [];
  return body.split("\n").map((line) => line.split("\t"));
}

export default function SheetGrid({
  columns,
  rows,
  merges = [],
  onChange: persist,
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
}: SheetGridProps) {
  const [range, setRange] = useState<CellRange>({
    anchor: { col: 0, row: 0 },
    focus: { col: 0, row: 0 },
  });
  const [editing, setEditing] = useState<CellAddress | null>(null);
  const [draft, setDraft] = useState("");
  const [renamingColumnIndex, setRenamingColumnIndex] = useState<number | null>(
    null,
  );
  const [typeMenuIndex, setTypeMenuIndex] = useState<number | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [paintFormat, setPaintFormat] = useState<SheetCellFormat | null>(null);
  const [formulaRange, setFormulaRange] = useState<CellRange | null>(null);
  const [history, setHistory] = useState<{ past: GridSnapshot[]; future: GridSnapshot[] }>({
    past: [],
    future: [],
  });

  const selected = range.focus;
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLInputElement>(null);
  const editSourceRef = useRef<"cell" | "formulaBar">("cell");
  const dragRef = useRef<
    "select" | "fill" | "formula" | "formula-col" | "formula-row" | null
  >(null);
  const fillOriginRef = useRef<CellRange | null>(null);
  const formulaPickOriginRef = useRef<CellAddress | null>(null);
  const formulaSpanRef = useRef<FormulaRefSpan | null>(null);
  const formulaPickingRef = useRef(false);
  const caretRef = useRef(0);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  const clipboardRef = useRef<string[][]>([]);
  const resizeStateRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    draftRef.current = draft;
    editingRef.current = editing;
  }, [draft, editing]);
  const showContextMenu = useContextMenu();

  const evaluator = useMemo(
    () => createSheetEvaluator(columns, rows),
    [columns, rows],
  );

  const commit = (next: {
    columns?: SheetColumn[];
    rows?: SheetRow[];
    merges?: SheetMerge[];
  }) => {
    setHistory((current) => ({
      past: [...current.past.slice(-79), { columns, rows, merges }],
      future: [],
    }));
    persist(next);
  };

  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [...history.future, { columns, rows, merges }],
    });
    persist(prev);
  };

  const redo = () => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({
      past: [...history.past, { columns, rows, merges }],
      future: history.future.slice(0, -1),
    });
    persist(next);
  };

  const rawAt = (address: CellAddress) => {
    const column = columns[address.col];
    const row = rows[address.row];
    if (!column || !row) return "";
    return row.cells?.[column.id] ?? "";
  };

  const visibleRows = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return rows.map((_, index) => index);
    return rows.flatMap((row, index) => {
      const haystack = columns
        .map((column) => `${column.name} ${row.cells?.[column.id] ?? ""}`)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query) ? [index] : [];
    });
  }, [columns, filterQuery, rows]);

  useEffect(() => {
    if (editing && editSourceRef.current === "cell") cellInputRef.current?.focus();
  }, [editing]);

  const setSelection = (next: CellAddress | CellRange, extend = false) => {
    if ("anchor" in next) {
      setRange({
        anchor: clampAddress(next.anchor, columns.length, rows.length),
        focus: clampAddress(next.focus, columns.length, rows.length),
      });
      return;
    }
    const focus = clampAddress(next, columns.length, rows.length);
    setRange((previous) =>
      extend ? { ...previous, focus } : { anchor: focus, focus },
    );
  };

  const setCellValue = (address: CellAddress, value: string) => {
    const column = columns[address.col];
    if (!column) return;
    const nextValue = isFormulaValue(value)
      ? value
      : normalizeTypedCell(column.type, value);

    commit({
      rows: rows.map((row, index) =>
        index === address.row
          ? { ...row, cells: { ...row.cells, [column.id]: nextValue } }
          : row,
      ),
    });
  };

  const patchCells = (
    mutator: (row: SheetRow, address: CellAddress, column: SheetColumn) => SheetRow,
  ) => {
    const nextRows: SheetRow[] = rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
      formats: { ...(row.formats ?? {}) },
    }));
    visitRange(range, (address) => {
      const column = columns[address.col];
      const row = nextRows[address.row];
      if (!column || !row) return;
      nextRows[address.row] = mutator(row, address, column);
    });
    commit({ rows: nextRows });
  };

  const copySelection = () => {
    const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
    const table: string[][] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      const line: string[] = [];
      for (let col = minCol; col <= maxCol; col += 1) {
        line.push(rawAt({ col, row }));
      }
      table.push(line);
    }
    clipboardRef.current = table;
    const tsv = table.map((line) => line.join("\t")).join("\n");
    void navigator.clipboard.writeText(tsv).catch(() => undefined);
  };

  const clearSelection = () => {
    patchCells((row, _address, column) => ({
      ...row,
      cells: { ...row.cells, [column.id]: "" },
    }));
  };

  const pasteTable = (table: string[][], origin: CellAddress) => {
    if (table.length === 0) return;
    const width = Math.max(...table.map((line) => line.length), 0);
    if (width === 0) return;
    const nextRows = rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
    }));
    for (let rowOffset = 0; rowOffset < table.length; rowOffset += 1) {
      const rowIndex = origin.row + rowOffset;
      if (rowIndex >= nextRows.length) break;
      for (let colOffset = 0; colOffset < table[rowOffset].length; colOffset += 1) {
        const colIndex = origin.col + colOffset;
        const column = columns[colIndex];
        const row = nextRows[rowIndex];
        if (!column || !row) continue;
        const value = table[rowOffset][colOffset] ?? "";
        row.cells[column.id] = isFormulaValue(value)
          ? value
          : normalizeTypedCell(column.type, value);
      }
    }
    commit({ rows: nextRows });
    setSelection({
      anchor: origin,
      focus: {
        col: Math.min(origin.col + width - 1, columns.length - 1),
        row: Math.min(origin.row + table.length - 1, rows.length - 1),
      },
    });
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const table = parseTsv(text);
      if (table.length) {
        pasteTable(table, selected);
        return;
      }
    } catch {
      // Fall through to the in-memory copy from Cut/Copy in this session.
    }
    if (clipboardRef.current.length) pasteTable(clipboardRef.current, selected);
  };

  const applyFormat = (patch: Partial<SheetCellFormat>) => {
    patchCells((row, address, column) => ({
      ...row,
      formats: setCellFormat(row.formats, column.id, patch),
    }));
  };

  const setColumnType = (index: number, type: SheetColumnType) => {
    commit({
      columns: columns.map((column, columnIndex) =>
        columnIndex === index ? { ...column, type } : column,
      ),
    });
    setTypeMenuIndex(null);
  };

  const toggleBoolean = (address: CellAddress) => {
    const current = rawAt(address);
    if (isFormulaValue(current)) return;
    setCellValue(address, isBooleanTrue(current) ? "FALSE" : "TRUE");
  };

  const addColumn = (atIndex = columns.length) => {
    const column: SheetColumn = {
      id: newColumnId(),
      name: columnIndexToLetter(atIndex),
      width: 160,
      type: "text",
    };

    const nextColumns = [...columns];
    nextColumns.splice(atIndex, 0, column);

    commit({
      columns: nextColumns,
      rows: rows.map((row) => ({
        ...row,
        cells: { ...row.cells, [column.id]: "" },
      })),
      merges: merges.map((merge) =>
        merge.startCol >= atIndex
          ? { ...merge, startCol: merge.startCol + 1 }
          : merge.startCol + merge.colSpan > atIndex
            ? { ...merge, colSpan: merge.colSpan + 1 }
            : merge,
      ),
    });
  };

  const deleteColumn = (index: number) => {
    if (columns.length <= 1) return;
    const removed = columns[index];
    commit({
      columns: columns.filter((_, columnIndex) => columnIndex !== index),
      rows: rows.map((row) => {
        const cells = { ...row.cells };
        const formats = { ...(row.formats ?? {}) };
        delete cells[removed.id];
        delete formats[removed.id];
        return { ...row, cells, formats: Object.keys(formats).length ? formats : undefined };
      }),
      merges: merges
        .filter((merge) => merge.startCol + merge.colSpan - 1 < index || merge.startCol > index)
        .map((merge) =>
          merge.startCol > index ? { ...merge, startCol: merge.startCol - 1 } : merge,
        ),
    });
    setSelection({
      col: Math.max(0, Math.min(selected.col, columns.length - 2)),
      row: selected.row,
    });
  };

  const addRows = (count = 1, atIndex = rows.length) => {
    const nextRows = [...rows];
    for (let index = 0; index < count; index += 1) {
      nextRows.splice(atIndex + index, 0, emptyRow(columns));
    }
    commit({
      rows: nextRows,
      merges: merges.map((merge) =>
        merge.startRow >= atIndex
          ? { ...merge, startRow: merge.startRow + count }
          : merge.startRow + merge.rowSpan > atIndex
            ? { ...merge, rowSpan: merge.rowSpan + count }
            : merge,
      ),
    });
  };

  const deleteRow = (index: number) => {
    if (rows.length <= 1) return;
    commit({
      rows: rows.filter((_, rowIndex) => rowIndex !== index),
      merges: merges
        .filter((merge) => merge.startRow + merge.rowSpan - 1 < index || merge.startRow > index)
        .map((merge) =>
          merge.startRow > index ? { ...merge, startRow: merge.startRow - 1 } : merge,
        ),
    });
    setSelection({
      col: selected.col,
      row: Math.max(0, Math.min(selected.row, rows.length - 2)),
    });
  };

  const renameColumn = (index: number, name: string) => {
    commit({
      columns: columns.map((column, columnIndex) =>
        columnIndex === index
          ? { ...column, name: name.trim() || columnIndexToLetter(index) }
          : column,
      ),
    });
  };

  const sortByColumn = (index: number, direction: "asc" | "desc") => {
    const column = columns[index];
    if (!column) return;
    const sorted = [...rows].sort((left, right) => {
      const a = left.cells?.[column.id] ?? "";
      const b = right.cells?.[column.id] ?? "";
      const aNum = Number(a.replace(/,/g, ""));
      const bNum = Number(b.replace(/,/g, ""));
      const bothNumeric = a !== "" && b !== "" && Number.isFinite(aNum) && Number.isFinite(bNum);
      const compared = bothNumeric
        ? aNum - bNum
        : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      return direction === "asc" ? compared : -compared;
    });
    commit({ rows: sorted, merges: [] });
    setOpenMenu(null);
  };

  const fillRange = (from: CellRange, to: CellAddress) => {
    const source = normalizedRange(from);
    const target = normalizedRange({ anchor: from.anchor, focus: to });
    const nextRows = rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
      formats: { ...(row.formats ?? {}) },
    }));

    for (let row = target.minRow; row <= target.maxRow; row += 1) {
      for (let col = target.minCol; col <= target.maxCol; col += 1) {
        if (
          col >= source.minCol &&
          col <= source.maxCol &&
          row >= source.minRow &&
          row <= source.maxRow
        ) {
          continue;
        }
        const srcCol =
          source.minCol + ((col - source.minCol) % (source.maxCol - source.minCol + 1) + (source.maxCol - source.minCol + 1)) % (source.maxCol - source.minCol + 1);
        const srcRow =
          source.minRow + ((row - source.minRow) % (source.maxRow - source.minRow + 1) + (source.maxRow - source.minRow + 1)) % (source.maxRow - source.minRow + 1);
        const sourceColumn = columns[srcCol];
        const targetColumn = columns[col];
        const sourceRow = nextRows[srcRow];
        const targetRow = nextRows[row];
        if (!sourceColumn || !targetColumn || !sourceRow || !targetRow) continue;
        const deltaCol = col - srcCol;
        const deltaRow = row - srcRow;
        let value = sourceRow.cells?.[sourceColumn.id] ?? "";
        if (isFormulaValue(value)) {
          value = shiftFormula(value, deltaCol, deltaRow);
        } else if (
          source.minCol === source.maxCol &&
          source.minRow === source.maxRow &&
          col === srcCol
        ) {
          const numeric = Number(value.replace(/,/g, ""));
          if (value !== "" && Number.isFinite(numeric)) {
            value = String(numeric + deltaRow);
          }
        }
        targetRow.cells[targetColumn.id] = isFormulaValue(value)
          ? value
          : normalizeTypedCell(targetColumn.type, value);
        const sourceFormat = sourceRow.formats?.[sourceColumn.id];
        if (sourceFormat) targetRow.formats[targetColumn.id] = sourceFormat;
      }
    }

    commit({
      rows: nextRows.map((row) => ({
        ...row,
        formats: Object.keys(row.formats).length ? row.formats : undefined,
      })),
    });
    setSelection({ anchor: from.anchor, focus: to });
  };

  const startEditing = (
    address: CellAddress,
    initialValue?: string,
    source: "cell" | "formulaBar" = "cell",
  ) => {
    editSourceRef.current = source;
    formulaSpanRef.current = null;
    formulaPickOriginRef.current = null;
    setFormulaRange(null);
    setSelection(address);
    const nextDraft = initialValue ?? rawAt(address);
    caretRef.current = nextDraft.length;
    setDraft(nextDraft);
    setEditing(address);
  };

  const clearFormulaPick = () => {
    formulaSpanRef.current = null;
    formulaPickOriginRef.current = null;
    formulaPickingRef.current = false;
    setFormulaRange(null);
  };

  const commitEdit = (move: "down" | "right" | "none" = "none") => {
    const address = editingRef.current;
    if (!address) return;
    const startedInFormulaBar = editSourceRef.current === "formulaBar";
    const raw = draftRef.current;
    const value = isFormulaValue(raw) ? closeOpenParens(raw.trim()) : raw;
    editingRef.current = null;
    setCellValue(address, value);
    setEditing(null);
    setDraft("");
    clearFormulaPick();
    if (move === "down") {
      setSelection({ col: address.col, row: Math.min(address.row + 1, rows.length - 1) });
    }
    if (move === "right") {
      setSelection({ col: Math.min(address.col + 1, columns.length - 1), row: address.row });
    }
    if (!startedInFormulaBar || move !== "none") gridRef.current?.focus();
  };

  const cancelEdit = () => {
    editingRef.current = null;
    setEditing(null);
    setDraft("");
    clearFormulaPick();
    gridRef.current?.focus();
  };

  const isEditingFormula = Boolean(editing && isFormulaValue(draft));

  const trackCaret = (target: HTMLInputElement) => {
    caretRef.current = target.selectionStart ?? target.value.length;
  };

  const focusFormulaInput = (caret: number) => {
    const target =
      editSourceRef.current === "formulaBar"
        ? formulaBarRef.current
        : cellInputRef.current;
    target?.focus();
    target?.setSelectionRange(caret, caret);
    caretRef.current = caret;
  };

  const applyFormulaRange = (picked: CellRange) => {
    const label = rangeAddressLabel(picked);
    const result = insertFormulaRange(
      draftRef.current,
      caretRef.current,
      label,
      formulaSpanRef.current,
    );
    formulaSpanRef.current = result.span;
    caretRef.current = result.caret;
    setDraft(result.value);
    setFormulaRange(picked);
    focusFormulaInput(result.caret);
    requestAnimationFrame(() => focusFormulaInput(result.caret));
  };

  const beginFormulaPick = (
    address: CellAddress,
    mode: "formula" | "formula-col" | "formula-row",
  ) => {
    formulaPickingRef.current = true;
    dragRef.current = mode;
    formulaPickOriginRef.current = address;
    const picked =
      mode === "formula-col"
        ? {
            anchor: { col: address.col, row: 0 },
            focus: { col: address.col, row: Math.max(rows.length - 1, 0) },
          }
        : mode === "formula-row"
          ? {
              anchor: { col: 0, row: address.row },
              focus: { col: Math.max(columns.length - 1, 0), row: address.row },
            }
          : { anchor: address, focus: address };
    applyFormulaRange(picked);
  };

  const extendFormulaPick = (address: CellAddress) => {
    const origin = formulaPickOriginRef.current;
    if (!origin || !dragRef.current?.startsWith("formula")) return;
    if (dragRef.current === "formula-col") {
      applyFormulaRange({
        anchor: { col: origin.col, row: 0 },
        focus: { col: address.col, row: Math.max(rows.length - 1, 0) },
      });
      return;
    }
    if (dragRef.current === "formula-row") {
      applyFormulaRange({
        anchor: { col: 0, row: origin.row },
        focus: { col: Math.max(columns.length - 1, 0), row: address.row },
      });
      return;
    }
    applyFormulaRange({ anchor: origin, focus: address });
  };

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    const extend = event.shiftKey;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        return setSelection({ col: selected.col, row: selected.row - 1 }, extend);
      case "ArrowDown":
        event.preventDefault();
        return setSelection({ col: selected.col, row: selected.row + 1 }, extend);
      case "ArrowLeft":
        event.preventDefault();
        return setSelection({ col: selected.col - 1, row: selected.row }, extend);
      case "ArrowRight":
        event.preventDefault();
        return setSelection({ col: selected.col + 1, row: selected.row }, extend);
      case "Tab":
        event.preventDefault();
        return setSelection(
          { col: selected.col + (event.shiftKey ? -1 : 1), row: selected.row },
        );
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEditing(selected);
      case "Delete":
      case "Backspace":
        event.preventDefault();
        return patchCells((row, _address, column) => ({
          ...row,
          cells: { ...row.cells, [column.id]: "" },
        }));
      case "z":
      case "Z":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          return event.shiftKey ? redo() : undo();
        }
        break;
      case "y":
      case "Y":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          return redo();
        }
        break;
      case "c":
      case "C":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          copySelection();
          return;
        }
        break;
      case "x":
      case "X":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          copySelection();
          clearSelection();
          return;
        }
        break;
      case "v":
      case "V":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          void pasteFromClipboard();
          return;
        }
        break;
      case "b":
      case "B":
      case "i":
      case "I":
      case "u":
      case "U":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          const current = formatAt(rows[selected.row], columns[selected.col]?.id);
          const key = event.key.toLowerCase();
          if (key === "b") return applyFormat({ bold: !current?.bold });
          if (key === "i") return applyFormat({ italic: !current?.italic });
          return applyFormat({ underline: !current?.underline });
        }
        break;
      default:
        break;
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      startEditing(selected, event.key);
    }
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const scale = zoom / 100 || 1;
      const width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(
          MIN_COLUMN_WIDTH,
          state.startWidth + (event.clientX - state.startX) / scale,
        ),
      );
      persist({
        columns: columns.map((column, index) =>
          index === state.index ? { ...column, width } : column,
        ),
      });
    };
    const handleMouseUp = () => {
      resizeStateRef.current = null;
      dragRef.current = null;
      fillOriginRef.current = null;
      formulaPickOriginRef.current = null;
      window.setTimeout(() => {
        formulaPickingRef.current = false;
      }, 0);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [columns, persist, zoom]);

  useEffect(() => {
    if (openMenu == null && typeMenuIndex == null) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-sheet-popover]")) return;
      setOpenMenu(null);
      setTypeMenuIndex(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) return;
      setOpenMenu(null);
      setTypeMenuIndex(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [editing, openMenu, typeMenuIndex]);

  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (formulaPickingRef.current) return;
      if (!isFormulaValue(draftRef.current)) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-sheet-popover]")) return;
      if (target.closest("[data-formula-bar]")) return;
      if (gridRef.current?.contains(target)) return;
      commitEdit();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [editing]);

  const gridTemplateColumns = `${ROW_HEADER_WIDTH}px ${columns
    .map((column) => `${column.width}px`)
    .join(" ")} 40px`;

  const selectedRaw = rawAt(selected);
  const selectedAddress = rangeAddressLabel(range);
  const selectedFormat = formatAt(rows[selected.row], columns[selected.col]?.id);
  const stats = selectionStats(
    range,
    (address) => {
      const result = evaluator.valueAt(address.col, address.row);
      return result.type === "number" ? result.value : null;
    },
    (address) => rawAt(address).trim() === "",
  );

  const selectedMerge = mergeFromRange(range);
  const canMerge = selectedMerge.colSpan > 1 || selectedMerge.rowSpan > 1;
  const mergeActive = hasMergeInRange(merges, range);

  const applyNumberFormat = (format: SheetNumberFormat) => {
    applyFormat({
      numberFormat: toggleNumberFormat(selectedFormat?.numberFormat, format),
    });
  };

  const bumpDecimals = (delta: number) => {
    const current =
      selectedFormat?.decimals ??
      (selectedFormat?.numberFormat === "currency" ||
      selectedFormat?.numberFormat === "percent"
        ? 2
        : 0);
    applyFormat({
      numberFormat: selectedFormat?.numberFormat ?? "number",
      decimals: Math.max(0, Math.min(8, current + delta)),
    });
  };

  const bumpFontSize = (delta: number) => {
    const current = selectedFormat?.fontSize ?? 13;
    applyFormat({ fontSize: Math.max(8, Math.min(36, current + delta)) });
  };

  const insertFormula = (template: (rangeLabel: string) => string) => {
    const multi = !sameAddress(range.anchor, range.focus);
    const guessed =
      !multi && rawAt(selected).trim() === ""
        ? guessAggregateRange(
            selected,
            columns.length,
            rows.length,
            (address) => evaluator.valueAt(address.col, address.row).type === "number",
          )
        : null;
    const picked = multi ? range : guessed;
    const label = picked ? rangeAddressLabel(picked) : "";
    const value = template(label);
    const target =
      picked && isInRange(selected, picked)
        ? formulaOutputAddress(picked, columns.length, rows.length)
        : selected;
    startEditing(target, value, "formulaBar");
    setOpenMenu(null);
    if (picked && label) {
      const start = value.indexOf(label);
      if (start >= 0) {
        formulaSpanRef.current = { start, end: start + label.length };
        caretRef.current = start + label.length;
        setFormulaRange(picked);
      }
    } else {
      const open = value.lastIndexOf("(");
      const close = value.indexOf(")", Math.max(open, 0));
      caretRef.current = close >= 0 ? close : value.length;
    }
    const caret = caretRef.current;
    requestAnimationFrame(() => {
      formulaBarRef.current?.focus();
      formulaBarRef.current?.setSelectionRange(caret, caret);
      caretRef.current = caret;
    });
  };

  const applyMerge = (next: SheetMerge[]) => {
    commit({ merges: next });
    setOpenMenu(null);
  };

  const cellMenu = (address: CellAddress): ContextMenuEntry[] => {
    const activeRange = isInRange(address, range)
      ? range
      : { anchor: address, focus: address };
    const span = mergeFromRange(activeRange);
    const canMergeHere = span.colSpan > 1 || span.rowSpan > 1;
    const merged = Boolean(findMerge(merges, address));
    return tidyEntries([
      {
        kind: "action",
        label: "Cut",
        icon: Scissors,
        shortcut: "mod+X",
        onSelect: () => {
          copySelection();
          clearSelection();
        },
      },
      {
        kind: "action",
        label: "Copy",
        icon: ClipboardCopy,
        shortcut: "mod+C",
        onSelect: copySelection,
      },
      {
        kind: "action",
        label: "Paste",
        icon: ClipboardPaste,
        shortcut: "mod+V",
        onSelect: () => void pasteFromClipboard(),
      },
      {
        kind: "action",
        label: "Clear",
        shortcut: "Delete",
        onSelect: clearSelection,
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Edit cell",
        icon: Pencil,
        shortcut: "F2",
        onSelect: () => startEditing(address),
      },
      canMergeHere || merged ? {
        kind: "submenu" as const,
        label: "Merge cells",
        icon: Combine,
        items: [
          {
            kind: "action" as const,
            label: "Merge all",
            disabled: !canMergeHere,
            onSelect: () => applyMerge(mergeAll(merges, activeRange)),
          },
          {
            kind: "action" as const,
            label: "Merge horizontally",
            disabled: span.colSpan <= 1,
            onSelect: () => applyMerge(mergeHorizontally(merges, activeRange)),
          },
          {
            kind: "action" as const,
            label: "Merge vertically",
            disabled: span.rowSpan <= 1,
            onSelect: () => applyMerge(mergeVertically(merges, activeRange)),
          },
          {
            kind: "action" as const,
            label: "Unmerge",
            disabled: !merged,
            onSelect: () => applyMerge(unmergeRange(merges, activeRange)),
          },
        ],
      } : false,
      { kind: "separator" },
      {
        kind: "action",
        label: "Insert row above",
        icon: BetweenHorizontalStart,
        onSelect: () => addRows(1, address.row),
      },
      {
        kind: "action",
        label: "Insert row below",
        icon: BetweenHorizontalEnd,
        onSelect: () => addRows(1, address.row + 1),
      },
      {
        kind: "action",
        label: "Insert column left",
        icon: BetweenVerticalStart,
        onSelect: () => addColumn(address.col),
      },
      {
        kind: "action",
        label: "Insert column right",
        icon: BetweenVerticalEnd,
        onSelect: () => addColumn(address.col + 1),
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Delete row",
        icon: Minus,
        disabled: rows.length <= 1,
        danger: true,
        onSelect: () => deleteRow(address.row),
      },
      {
        kind: "action",
        label: "Delete column",
        icon: Trash2,
        disabled: columns.length <= 1,
        danger: true,
        onSelect: () => deleteColumn(address.col),
      },
    ]);
  };

  const columnMenu = (index: number): ContextMenuEntry[] => {
    const column = columns[index];
    return tidyEntries([
      {
        kind: "action",
        label: "Rename column",
        icon: Pencil,
        shortcut: "F2",
        onSelect: () => setRenamingColumnIndex(index),
      },
      {
        kind: "submenu",
        label: "Column type",
        icon: Type,
        items: SHEET_COLUMN_TYPES.map<ContextMenuEntry>((option) => ({
          kind: "action",
          label: option.label,
          checked: column?.type === option.value,
          onSelect: () => setColumnType(index, option.value),
        })),
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Sort A → Z",
        icon: ArrowUpAZ,
        onSelect: () => sortByColumn(index, "asc"),
      },
      {
        kind: "action",
        label: "Sort Z → A",
        icon: ArrowDownAZ,
        onSelect: () => sortByColumn(index, "desc"),
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Insert column left",
        icon: BetweenVerticalStart,
        onSelect: () => addColumn(index),
      },
      {
        kind: "action",
        label: "Insert column right",
        icon: BetweenVerticalEnd,
        onSelect: () => addColumn(index + 1),
      },
      {
        kind: "action",
        label: "Delete column",
        icon: Trash2,
        disabled: columns.length <= 1,
        danger: true,
        onSelect: () => deleteColumn(index),
      },
    ]);
  };

  const rowMenu = (index: number): ContextMenuEntry[] =>
    tidyEntries([
      {
        kind: "action",
        label: "Insert row above",
        icon: BetweenHorizontalStart,
        onSelect: () => addRows(1, index),
      },
      {
        kind: "action",
        label: "Insert row below",
        icon: BetweenHorizontalEnd,
        onSelect: () => addRows(1, index + 1),
      },
      {
        kind: "action",
        label: "Delete row",
        icon: Minus,
        disabled: rows.length <= 1,
        danger: true,
        onSelect: () => deleteRow(index),
      },
    ]);

  const printSheet = () => {
    const markup = gridRef.current?.innerHTML ?? "";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    if (!frameWindow || !frameDocument) {
      iframe.remove();
      return;
    }
    const cleanup = () => iframe.remove();
    frameWindow.addEventListener("afterprint", cleanup);
    frameDocument.open();
    frameDocument.write(
      `<html><head><title>Sheet</title><style>
        body{font:12px sans-serif;background:#fff;color:#111;margin:16px}
        button{display:none}
      </style></head><body>${markup}</body></html>`,
    );
    frameDocument.close();
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(cleanup, 1000);
  };

  const chartValues = useMemo(() => {
    const values: { label: string; value: number }[] = [];
    visitRange(range, (address) => {
      const result = evaluator.valueAt(address.col, address.row);
      if (result.type === "number") {
        values.push({
          label: `${columnIndexToLetter(address.col)}${address.row + 1}`,
          value: result.value,
        });
      }
    });
    return values;
  }, [evaluator, range]);

  const chartMax = Math.max(1, ...chartValues.map((item) => Math.abs(item.value)));
  const bounds = normalizedRange(range);
  const toolClass = (active = false) =>
    `flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35 ${
      active ? "bg-accent text-foreground" : "text-muted-foreground"
    }`;

  const toggleMenu = (name: string) => {
    setTypeMenuIndex(null);
    setOpenMenu((current) => (current === name ? null : name));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-[#191B22] px-2 py-1">
        <button type="button" title="Undo (⌘Z)" disabled={history.past.length === 0} onClick={undo} className={toolClass()}>
          <Undo2 className="size-4" />
        </button>
        <button type="button" title="Redo (⌘Y)" disabled={history.future.length === 0} onClick={redo} className={toolClass()}>
          <Redo2 className="size-4" />
        </button>
        <button type="button" title="Print" onClick={printSheet} className={toolClass()}>
          <Printer className="size-4" />
        </button>
        <button
          type="button"
          title="Paint format"
          onClick={() => setPaintFormat(paintFormat ? null : { ...(selectedFormat ?? {}) })}
          className={toolClass(Boolean(paintFormat))}
        >
          <Paintbrush className="size-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <div className="relative" data-sheet-popover>
          <button type="button" title="Zoom" onClick={() => toggleMenu("zoom")} className={`${toolClass(openMenu === "zoom")} w-auto px-1.5 font-mono text-[11px]`}>
            {zoom}%
          </button>
          {openMenu === "zoom" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-24`}>
              {ZOOM_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setZoom(option);
                    setOpenMenu(null);
                  }}
                  className={`${POPOVER_ITEM} ${zoom === option ? "bg-accent" : ""}`}
                >
                  {option}%
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button type="button" title="Format as currency" onClick={() => applyNumberFormat("currency")} className={toolClass(selectedFormat?.numberFormat === "currency")}>
          <span className="font-mono text-xs">$</span>
        </button>
        <button type="button" title="Format as percent" onClick={() => applyNumberFormat("percent")} className={toolClass(selectedFormat?.numberFormat === "percent")}>
          <span className="font-mono text-xs">%</span>
        </button>
        <button type="button" title="Decrease decimal places" onClick={() => bumpDecimals(-1)} className={toolClass()}>
          <span className="font-mono text-[10px]">.0</span>
        </button>
        <button type="button" title="Increase decimal places" onClick={() => bumpDecimals(1)} className={toolClass()}>
          <span className="font-mono text-[10px]">.00</span>
        </button>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Number format" onClick={() => toggleMenu("number")} className={`${toolClass(openMenu === "number")} w-auto px-1.5 font-mono text-[11px]`}>
            123
          </button>
          {openMenu === "number" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-40`}>
              {NUMBER_FORMATS.map((format) => (
                <button
                  key={format.label}
                  type="button"
                  onClick={() => {
                    if (format.value) applyNumberFormat(format.value);
                    else applyFormat({ numberFormat: undefined, decimals: undefined });
                    setOpenMenu(null);
                  }}
                  className={POPOVER_ITEM}
                >
                  {format.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <div className="relative" data-sheet-popover>
          <button type="button" title="Font" onClick={() => toggleMenu("font")} className={`${toolClass(openMenu === "font")} w-auto px-1.5 text-[11px]`}>
            {selectedFormat?.fontFamily === "serif" ? "Serif" : selectedFormat?.fontFamily === "mono" ? "Mono" : "Default"}
          </button>
          {openMenu === "font" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-28`}>
              {(["default", "serif", "mono"] as SheetFontFamily[]).map((family) => (
                <button
                  key={family}
                  type="button"
                  onClick={() => {
                    applyFormat({ fontFamily: family === "default" ? undefined : family });
                    setOpenMenu(null);
                  }}
                  className={`${POPOVER_ITEM} capitalize`}
                >
                  {family}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="Decrease font size" onClick={() => bumpFontSize(-1)} className={toolClass()}>
          <Minus className="size-3.5" />
        </button>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Font size" onClick={() => toggleMenu("size")} className={`${toolClass(openMenu === "size")} w-auto px-1.5 font-mono text-[11px]`}>
            {selectedFormat?.fontSize ?? 13}
          </button>
          {openMenu === "size" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-16`}>
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    applyFormat({ fontSize: size });
                    setOpenMenu(null);
                  }}
                  className={POPOVER_ITEM}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="Increase font size" onClick={() => bumpFontSize(1)} className={toolClass()}>
          <Plus className="size-3.5" />
        </button>
        <button type="button" title="Bold (⌘B)" onClick={() => applyFormat({ bold: !selectedFormat?.bold })} className={toolClass(Boolean(selectedFormat?.bold))}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" title="Italic (⌘I)" onClick={() => applyFormat({ italic: !selectedFormat?.italic })} className={toolClass(Boolean(selectedFormat?.italic))}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" title="Underline (⌘U)" onClick={() => applyFormat({ underline: !selectedFormat?.underline })} className={toolClass(Boolean(selectedFormat?.underline))}>
          <Underline className="size-3.5" />
        </button>
        <button type="button" title="Strikethrough" onClick={() => applyFormat({ strikethrough: !selectedFormat?.strikethrough })} className={toolClass(Boolean(selectedFormat?.strikethrough))}>
          <Strikethrough className="size-3.5" />
        </button>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Text color" onClick={() => toggleMenu("textColor")} className={toolClass(openMenu === "textColor")}>
            <Type className="size-3.5" style={{ color: selectedFormat?.textColor }} />
          </button>
          {openMenu === "textColor" && (
            <div className="absolute left-0 top-8 z-40 flex gap-1 rounded-md border border-border bg-popover p-2 shadow-lg">
              <button type="button" title="Default" onClick={() => { applyFormat({ textColor: undefined }); setOpenMenu(null); }} className="size-5 rounded border border-border" />
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => { applyFormat({ textColor: color }); setOpenMenu(null); }}
                  className="size-5 rounded border border-border"
                  style={{ background: color }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Fill color" onClick={() => toggleMenu("fill")} className={toolClass(openMenu === "fill")}>
            <Highlighter className="size-3.5" />
          </button>
          {openMenu === "fill" && (
            <div className="absolute left-0 top-8 z-40 flex gap-1 rounded-md border border-border bg-popover p-2 shadow-lg">
              <button type="button" title="No fill" onClick={() => { applyFormat({ fillColor: undefined }); setOpenMenu(null); }} className="size-5 rounded border border-border" />
              {FILL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => { applyFormat({ fillColor: color }); setOpenMenu(null); }}
                  className="size-5 rounded border border-border"
                  style={{ background: color }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Borders" onClick={() => toggleMenu("border")} className={toolClass(Boolean(selectedFormat?.border) || openMenu === "border")}>
            <Square className="size-3.5" />
          </button>
          {openMenu === "border" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-28`}>
              <button
                type="button"
                onClick={() => {
                  applyFormat({ border: undefined });
                  setOpenMenu(null);
                }}
                className={POPOVER_ITEM}
              >
                None
              </button>
              {([
                ["all", "All borders"],
                ["outer", "Outer"],
                ["top", "Top"],
                ["bottom", "Bottom"],
                ["left", "Left"],
                ["right", "Right"],
              ] as [SheetBorder, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    applyFormat({ border: selectedFormat?.border === value ? undefined : value });
                    setOpenMenu(null);
                  }}
                  className={POPOVER_ITEM}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative flex" data-sheet-popover>
          <button
            type="button"
            title={canMerge || mergeActive ? "Merge cells" : "Select more than one cell to merge"}
            disabled={!canMerge && !mergeActive}
            onClick={() =>
              applyMerge(mergeActive ? unmergeRange(merges, range) : mergeAll(merges, range))
            }
            className={toolClass(mergeActive)}
          >
            <Combine className="size-3.5" />
          </button>
          <button
            type="button"
            title="Select merge type"
            disabled={!canMerge && !mergeActive}
            onClick={() => toggleMenu("merge")}
            className={`${toolClass(openMenu === "merge")} w-auto px-0.5`}
          >
            <ChevronDown className="size-3" />
          </button>
          {openMenu === "merge" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-44`}>
              <button
                type="button"
                disabled={!canMerge}
                onClick={() => applyMerge(mergeAll(merges, range))}
                className={`${POPOVER_ITEM} disabled:pointer-events-none disabled:opacity-35`}
              >
                Merge all
              </button>
              <button
                type="button"
                disabled={selectedMerge.colSpan <= 1}
                onClick={() => applyMerge(mergeHorizontally(merges, range))}
                className={`${POPOVER_ITEM} disabled:pointer-events-none disabled:opacity-35`}
              >
                Merge horizontally
              </button>
              <button
                type="button"
                disabled={selectedMerge.rowSpan <= 1}
                onClick={() => applyMerge(mergeVertically(merges, range))}
                className={`${POPOVER_ITEM} disabled:pointer-events-none disabled:opacity-35`}
              >
                Merge vertically
              </button>
              <button
                type="button"
                disabled={!mergeActive}
                onClick={() => applyMerge(unmergeRange(merges, range))}
                className={`${POPOVER_ITEM} disabled:pointer-events-none disabled:opacity-35`}
              >
                Unmerge
              </button>
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Horizontal align"
            onClick={() => toggleMenu("align")}
            className={`${toolClass(openMenu === "align")} w-auto gap-0.5 px-1`}
          >
            {selectedFormat?.align === "center" ? (
              <AlignCenter className="size-3.5" />
            ) : selectedFormat?.align === "right" ? (
              <AlignRight className="size-3.5" />
            ) : (
              <AlignLeft className="size-3.5" />
            )}
            <ChevronDown className="size-3" />
          </button>
          {openMenu === "align" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-28`}>
              <button type="button" onClick={() => { applyFormat({ align: "left" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Left
              </button>
              <button type="button" onClick={() => { applyFormat({ align: "center" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Center
              </button>
              <button type="button" onClick={() => { applyFormat({ align: "right" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Right
              </button>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Vertical align"
            onClick={() => toggleMenu("valign")}
            className={`${toolClass(openMenu === "valign")} w-auto gap-0.5 px-1`}
          >
            {selectedFormat?.verticalAlign === "top" ? (
              <AlignVerticalJustifyStart className="size-3.5" />
            ) : selectedFormat?.verticalAlign === "bottom" ? (
              <AlignVerticalJustifyEnd className="size-3.5" />
            ) : (
              <AlignVerticalJustifyCenter className="size-3.5" />
            )}
            <ChevronDown className="size-3" />
          </button>
          {openMenu === "valign" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-28`}>
              <button type="button" onClick={() => { applyFormat({ verticalAlign: "top" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Top
              </button>
              <button type="button" onClick={() => { applyFormat({ verticalAlign: "middle" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Middle
              </button>
              <button type="button" onClick={() => { applyFormat({ verticalAlign: "bottom" }); setOpenMenu(null); }} className={POPOVER_ITEM}>
                Bottom
              </button>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Text wrapping"
            onClick={() => toggleMenu("wrap")}
            className={toolClass(Boolean(selectedFormat?.wrap) || Boolean(selectedFormat?.clip) || openMenu === "wrap")}
          >
            <WrapText className="size-3.5" />
          </button>
          {openMenu === "wrap" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-32`}>
              <button
                type="button"
                onClick={() => {
                  applyFormat({ wrap: false, clip: false });
                  setOpenMenu(null);
                }}
                className={POPOVER_ITEM}
              >
                Overflow
              </button>
              <button
                type="button"
                onClick={() => {
                  applyFormat({ wrap: true, clip: false });
                  setOpenMenu(null);
                }}
                className={POPOVER_ITEM}
              >
                Wrap
              </button>
              <button
                type="button"
                onClick={() => {
                  applyFormat({ wrap: false, clip: true });
                  setOpenMenu(null);
                }}
                className={POPOVER_ITEM}
              >
                Clip
              </button>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Text rotation"
            onClick={() => toggleMenu("rotation")}
            className={`${toolClass(Boolean(selectedFormat?.rotation) || openMenu === "rotation")} w-auto px-1.5 font-mono text-[11px]`}
          >
            {selectedFormat?.rotation ? `${selectedFormat.rotation}°` : "A"}
          </button>
          {openMenu === "rotation" && (
            <div className={`${POPOVER_PANEL} left-0 top-8 w-24`}>
              {ROTATIONS.map((angle) => (
                <button
                  key={angle}
                  type="button"
                  onClick={() => {
                    applyFormat({ rotation: angle || undefined });
                    setOpenMenu(null);
                  }}
                  className={POPOVER_ITEM}
                >
                  {angle === 0 ? "None" : `${angle}°`}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <div className="relative" data-sheet-popover>
          <button type="button" title="Insert link" onClick={() => toggleMenu("link")} className={toolClass(Boolean(selectedFormat?.link) || openMenu === "link")}>
            <Link2 className="size-3.5" />
          </button>
          {openMenu === "link" && (
            <div className="absolute left-0 top-8 z-40 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
              <input
                autoFocus
                defaultValue={selectedFormat?.link ?? ""}
                placeholder="https://"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyFormat({ link: event.currentTarget.value.trim() || undefined });
                    setOpenMenu(null);
                  }
                }}
                className="w-full rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none"
              />
              <div className="mt-2 flex justify-end gap-1">
                <button type="button" onClick={() => { applyFormat({ link: undefined }); setOpenMenu(null); }} className="rounded px-2 py-1 text-[11px] hover:bg-accent">
                  Remove
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    const input = event.currentTarget
                      .closest(".absolute")
                      ?.querySelector("input");
                    applyFormat({ link: input?.value.trim() || undefined });
                    setOpenMenu(null);
                  }}
                  className="rounded bg-secondary px-2 py-1 text-[11px] hover:bg-accent"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Note" onClick={() => toggleMenu("note")} className={toolClass(Boolean(selectedFormat?.note) || openMenu === "note")}>
            <MessageSquare className="size-3.5" />
          </button>
          {openMenu === "note" && (
            <div className="absolute left-0 top-8 z-40 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
              <textarea
                autoFocus
                defaultValue={selectedFormat?.note ?? ""}
                placeholder="Cell note"
                rows={3}
                onBlur={(event) => applyFormat({ note: event.currentTarget.value.trim() || undefined })}
                className="w-full rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none"
              />
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Chart selected numbers" onClick={() => toggleMenu("chart")} className={toolClass(openMenu === "chart")}>
            <BarChart3 className="size-3.5" />
          </button>
          {openMenu === "chart" && (
            <div className="absolute right-0 top-8 z-40 w-64 rounded-md border border-border bg-popover p-3 shadow-xl">
              <p className="mb-2 text-[11px] font-medium text-foreground">Selected values</p>
              {chartValues.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Select numeric cells to chart.</p>
              ) : (
                <div className="flex h-24 items-end gap-1">
                  {chartValues.slice(0, 12).map((item) => (
                    <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-primary"
                        style={{ height: `${Math.max(8, (Math.abs(item.value) / chartMax) * 80)}px` }}
                        title={`${item.label}: ${item.value}`}
                      />
                      <span className="truncate font-mono text-[9px] text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Filter & sort" onClick={() => toggleMenu("filter")} className={toolClass(openMenu === "filter" || Boolean(filterQuery))}>
            <Filter className="size-3.5" />
          </button>
          {openMenu === "filter" && (
            <div className="absolute right-0 top-8 z-40 w-56 rounded-lg border border-border bg-popover p-2 shadow-xl">
              <input
                autoFocus
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Filter rows..."
                className="w-full rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none focus:border-ring"
              />
              <div className="mt-2 flex gap-1">
                <button type="button" onClick={() => sortByColumn(selected.col, "asc")} className="flex-1 rounded-md bg-secondary px-2 py-1 text-[11px] hover:bg-accent">
                  Sort A → Z
                </button>
                <button type="button" onClick={() => sortByColumn(selected.col, "desc")} className="flex-1 rounded-md bg-secondary px-2 py-1 text-[11px] hover:bg-accent">
                  Sort Z → A
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Functions" onClick={() => toggleMenu("fx")} className={toolClass(openMenu === "fx")}>
            <Sigma className="size-3.5" />
          </button>
          {openMenu === "fx" && (
            <div className={`${POPOVER_PANEL} right-0 top-8 w-36`}>
              {FORMULA_INSERTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => insertFormula(item.template)}
                  className={`${POPOVER_ITEM} font-mono`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button type="button" title="Add column before" onClick={() => addColumn(selected.col)} className={toolClass()}>
          <BetweenVerticalStart className="size-3.5" />
        </button>
        <button type="button" title="Add column after" onClick={() => addColumn(selected.col + 1)} className={toolClass()}>
          <BetweenVerticalEnd className="size-3.5" />
        </button>
        <button type="button" title="Delete column" disabled={columns.length <= 1} onClick={() => deleteColumn(selected.col)} className={toolClass()}>
          <Minus className="size-3.5" />
        </button>
        <button type="button" title="Add row before" onClick={() => addRows(1, selected.row)} className={toolClass()}>
          <BetweenHorizontalStart className="size-3.5" />
        </button>
        <button type="button" title="Add row after" onClick={() => addRows(1, selected.row + 1)} className={toolClass()}>
          <BetweenHorizontalEnd className="size-3.5" />
        </button>
        <button type="button" title="Delete row" disabled={rows.length <= 1} onClick={() => deleteRow(selected.row)} className={toolClass()}>
          <Minus className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-[#191B22] px-3 py-1.5" data-formula-bar>
        <span className="w-16 shrink-0 rounded-md border border-[#7C66DC] bg-[#6E56CF] px-2 py-1 text-center font-mono text-xs font-semibold text-white shadow-[0_0_12px_rgba(110,86,207,0.2)]">
          {selectedAddress}
        </span>
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-input/30 px-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <span className="mr-2 shrink-0 font-mono text-xs italic text-muted-foreground">fx</span>
          <span className="mr-2 h-3.5 w-px bg-border" />
          <input
            ref={formulaBarRef}
            value={editing ? draft : selectedRaw}
            onFocus={() => {
              editSourceRef.current = "formulaBar";
              if (!editing) startEditing(selected, undefined, "formulaBar");
            }}
            onSelect={(event) => trackCaret(event.currentTarget)}
            onClick={(event) => trackCaret(event.currentTarget)}
            onKeyUp={(event) => trackCaret(event.currentTarget)}
            onChange={(event) => {
              formulaSpanRef.current = null;
              setFormulaRange(null);
              trackCaret(event.currentTarget);
              if (!editing) {
                startEditing(selected, event.target.value, "formulaBar");
              } else {
                setDraft(event.target.value);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (formulaPickingRef.current) return;
                if (!editingRef.current) return;
                const active = document.activeElement;
                if (active === formulaBarRef.current || active === cellInputRef.current) return;
                if (
                  isFormulaValue(draftRef.current) &&
                  active instanceof Node &&
                  gridRef.current?.contains(active)
                ) {
                  return;
                }
                commitEdit();
              }, 0);
            }}
            onKeyDown={(event) => {
              trackCaret(event.currentTarget);
              if (event.key === "Enter") {
                event.preventDefault();
                commitEdit("down");
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
            }}
            placeholder="Enter a value or formula (=SUM, =AVERAGE)"
            className="min-w-0 flex-1 bg-transparent py-1 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none select-none"
        style={{ zoom: zoom / 100 }}
      >
        <div className="inline-block min-w-full">
          <div
            className="sticky top-0 z-20 grid bg-muted"
            style={{ gridTemplateColumns }}
          >
            <div className="sticky left-0 z-30 border-b border-r border-border bg-muted text-center font-mono text-[10px] text-muted-foreground">
              #
            </div>

            {columns.map((column, index) => (
              <div
                key={column.id}
                onContextMenu={(event) => {
                  setSelection({ col: index, row: selected.row });
                  showContextMenu(event, columnMenu(index), { title: column.name });
                }}
                onMouseDown={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("[data-sheet-popover]")) return;
                  if (target.getAttribute("role") === "separator") return;
                  event.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  if (!isEditingFormula) return;
                  beginFormulaPick({ col: index, row: 0 }, "formula-col");
                }}
                onMouseEnter={() => {
                  if (dragRef.current === "formula-col") {
                    extendFormulaPick({ col: index, row: 0 });
                  }
                }}
                className={`group relative flex items-center gap-1.5 border-b border-r border-border px-2 py-1.5 ${
                  index >= bounds.minCol && index <= bounds.maxCol ? "bg-accent/60" : ""
                } ${
                  formulaRange &&
                  index >= normalizedRange(formulaRange).minCol &&
                  index <= normalizedRange(formulaRange).maxCol
                    ? "outline outline-dashed outline-primary/70"
                    : ""
                }`}
              >
                <span className="shrink-0 font-mono text-[10px] font-bold text-muted-foreground">
                  {columnIndexToLetter(index)}
                </span>

                {renamingColumnIndex === index ? (
                  <input
                    autoFocus
                    defaultValue={column.name}
                    onBlur={(event) => {
                      renameColumn(index, event.target.value);
                      setRenamingColumnIndex(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setRenamingColumnIndex(null);
                    }}
                    className="min-w-0 flex-1 select-text rounded border border-ring bg-input/40 px-1 text-xs text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => setRenamingColumnIndex(index)}
                    onClick={() => {
                      if (isEditingFormula) return;
                      setSelection({ col: index, row: selected.row });
                    }}
                    title="Double-click to rename"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground"
                  >
                    {column.name}
                  </button>
                )}

                <div className="relative shrink-0" data-sheet-popover>
                  <button
                    type="button"
                    title="Column type"
                    onClick={() =>
                      setTypeMenuIndex((current) => (current === index ? null : index))
                    }
                    className="rounded border border-border bg-background/60 px-1 font-mono text-[9px] uppercase text-muted-foreground hover:bg-accent"
                  >
                    {columnTypeBadge(column.type)}
                  </button>
                  {typeMenuIndex === index ? (
                    <div className="absolute right-0 top-6 z-40 min-w-28 rounded-md border border-border bg-popover p-1 shadow-lg">
                      {SHEET_COLUMN_TYPES.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setColumnType(index, option.value)}
                          className={`block w-full rounded px-2 py-1 text-left text-xs ${
                            column.type === option.value
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  title="Delete column"
                  onClick={() => deleteColumn(index)}
                  disabled={columns.length <= 1}
                  className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition hover:text-destructive group-hover:opacity-100 disabled:hidden"
                >
                  <Trash2 className="size-3" />
                </button>

                <span
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    resizeStateRef.current = {
                      index,
                      startX: event.clientX,
                      startWidth: column.width,
                    };
                  }}
                  className="absolute -right-0.5 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary"
                />
              </div>
            ))}

            <button
              type="button"
              title="Add column"
              onClick={() => addColumn()}
              className="flex cursor-pointer items-center justify-center border-b border-border text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              +
            </button>
          </div>

          {visibleRows.map((rowIndex) => (
            <div key={rows[rowIndex].id} className="grid" style={{ gridTemplateColumns }}>
              <div
                className={`sticky left-0 z-10 border-b border-r border-border px-2 text-center font-mono text-[11px] text-muted-foreground ${
                  rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow
                    ? "bg-accent/60 text-primary"
                    : "bg-muted"
                } ${
                  formulaRange &&
                  rowIndex >= normalizedRange(formulaRange).minRow &&
                  rowIndex <= normalizedRange(formulaRange).maxRow
                    ? "outline outline-dashed outline-primary/70"
                    : ""
                }`}
                style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  if (!isEditingFormula) return;
                  beginFormulaPick({ col: 0, row: rowIndex }, "formula-row");
                }}
                onMouseEnter={() => {
                  if (dragRef.current === "formula-row") {
                    extendFormulaPick({ col: 0, row: rowIndex });
                  }
                }}
                onContextMenu={(event) => {
                  setSelection({ col: selected.col, row: rowIndex });
                  showContextMenu(event, rowMenu(rowIndex), {
                    title: `Row ${rowIndex + 1}`,
                  });
                }}
              >
                {rowIndex + 1}
              </div>

              {columns.map((column, colIndex) => {
                const address = { col: colIndex, row: rowIndex };
                if (coveredByMerge(merges, address)) {
                  const covered = findMerge(merges, address);
                  if (covered && address.col === covered.startCol) {
                    return (
                      <div
                        key={column.id}
                        aria-hidden
                        className="border-b border-border"
                        style={{
                          gridColumn: `span ${covered.colSpan}`,
                          height: ROW_HEIGHT,
                        }}
                      />
                    );
                  }
                  return null;
                }

                const merge = findMerge(merges, address);
                const isSelected = sameAddress(selected, address);
                const inRange = isInRange(address, range);
                const isEditing = editing?.col === colIndex && editing?.row === rowIndex;
                const result = evaluator.valueAt(colIndex, rowIndex);
                const raw = rawAt(address);
                const format = formatAt(rows[rowIndex], column.id);
                const display = formatSheetDisplay(result, column.type, raw, format);
                const chip = column.type === "text" || column.type === "formula" ? statusChip(display) : null;
                const align = format?.align ?? defaultAlign(column.type);
                const inFormulaRange = Boolean(formulaRange && isInRange(address, formulaRange));
                const isFillCorner =
                  colIndex === bounds.maxCol && rowIndex === bounds.maxRow && !isEditingFormula;
                const verticalAlign: SheetVerticalAlign = format?.verticalAlign ?? "middle";

                return (
                  <div
                    key={column.id}
                    onMouseDown={(event) => {
                      if (isEditingFormula && !isEditing) {
                        event.preventDefault();
                        beginFormulaPick(address, "formula");
                        return;
                      }
                      if (isEditing) return;
                      event.preventDefault();
                      window.getSelection()?.removeAllRanges();
                      gridRef.current?.focus();
                      if (paintFormat) {
                        event.preventDefault();
                        const copied = { ...paintFormat };
                        commit({
                          rows: rows.map((row, index) => {
                            if (index !== rowIndex) return row;
                            const formats = { ...(row.formats ?? {}) };
                            if (isEmptyCellFormat(copied)) delete formats[column.id];
                            else formats[column.id] = copied;
                            return {
                              ...row,
                              formats: Object.keys(formats).length ? formats : undefined,
                            };
                          }),
                        });
                        setPaintFormat(null);
                        setSelection(address);
                        return;
                      }
                      const mergeAt = findMerge(merges, address);
                      if (event.shiftKey) {
                        setSelection(address, true);
                      } else if (mergeAt) {
                        setSelection(rangeFromMerge(mergeAt));
                      } else {
                        setSelection(address);
                      }
                      dragRef.current = "select";
                    }}
                    onMouseEnter={() => {
                      if (dragRef.current?.startsWith("formula")) {
                        extendFormulaPick(address);
                        return;
                      }
                      if (dragRef.current === "select") setSelection(address, true);
                      if (dragRef.current === "fill" && fillOriginRef.current) {
                        setSelection({
                          anchor: fillOriginRef.current.anchor,
                          focus: address,
                        });
                      }
                    }}
                    onMouseUp={() => {
                      if (dragRef.current === "fill" && fillOriginRef.current) {
                        fillRange(fillOriginRef.current, address);
                      }
                      dragRef.current = null;
                    }}
                    onDoubleClick={() => startEditing(address)}
                    onContextMenu={(event) => {
                      if (!inRange) setSelection(address);
                      showContextMenu(event, cellMenu(address), {
                        title: rangeAddressLabel(inRange ? range : { anchor: address, focus: address }),
                      });
                    }}
                    onClick={() => {
                      if (!isSelected) return;
                      if (column.type === "boolean" && !isFormulaValue(raw)) {
                        toggleBoolean(address);
                      }
                    }}
                    className={`relative flex min-w-0 border-b border-r border-border px-2 text-sm ${
                      verticalAlign === "top"
                        ? "items-start"
                        : verticalAlign === "bottom"
                          ? "items-end"
                          : "items-center"
                    } ${
                      inRange && !format?.fillColor ? "bg-[#6E56CF]/10" : ""
                    } ${isSelected ? "z-10 bg-[#251F3E] ring-2 ring-inset ring-[#7C66DC]" : ""} ${
                      inFormulaRange ? "outline outline-dashed outline-1 outline-primary" : ""
                    } ${
                      result.type === "error" ? "text-destructive" : ""
                    } ${evaluator.isFormula(colIndex, rowIndex) && result.type === "number" && !format?.textColor ? "text-primary" : ""} ${
                      format?.border === "all" ? "ring-1 ring-inset ring-foreground/50" : ""
                    } ${format?.border === "bottom" ? "border-b-foreground/70" : ""} ${
                      format?.border === "top" ? "border-t-foreground/70" : ""
                    } ${format?.border === "left" ? "border-l-foreground/70" : ""} ${
                      format?.border === "right" ? "border-r-foreground/70" : ""
                    } ${
                      format?.border === "outer" ? "outline outline-1 outline-foreground/40" : ""
                    } ${format?.clip ? "overflow-hidden" : ""} ${
                      merge && isMergeOrigin(merge, address) ? "z-[8] bg-background" : ""
                    }`}
                    style={{
                      gridColumn:
                        merge && isMergeOrigin(merge, address) && merge.colSpan > 1
                          ? `span ${merge.colSpan}`
                          : undefined,
                      height: format?.wrap
                        ? "auto"
                        : merge && isMergeOrigin(merge, address)
                          ? ROW_HEIGHT * merge.rowSpan
                          : ROW_HEIGHT,
                      minHeight: merge && isMergeOrigin(merge, address)
                        ? ROW_HEIGHT * merge.rowSpan
                        : ROW_HEIGHT,
                      textAlign: align,
                      justifyContent:
                        align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
                      fontWeight: format?.bold ? 700 : undefined,
                      fontStyle: format?.italic ? "italic" : undefined,
                      textDecoration: cellTextDecoration(format),
                      color: format?.textColor,
                      backgroundColor: format?.fillColor,
                      fontSize: format?.fontSize ? `${format.fontSize}px` : undefined,
                      fontFamily: cellFormatFontFamily(format?.fontFamily),
                      whiteSpace: format?.wrap ? "pre-wrap" : undefined,
                      overflowWrap: format?.wrap ? "anywhere" : undefined,
                      transform: format?.rotation ? `rotate(${format.rotation}deg)` : undefined,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={cellInputRef}
                        value={draft}
                        onFocus={() => {
                          editSourceRef.current = "cell";
                        }}
                        onSelect={(event) => trackCaret(event.currentTarget)}
                        onClick={(event) => trackCaret(event.currentTarget)}
                        onKeyUp={(event) => trackCaret(event.currentTarget)}
                        onChange={(event) => {
                          formulaSpanRef.current = null;
                          setFormulaRange(null);
                          trackCaret(event.currentTarget);
                          setDraft(event.target.value);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            if (formulaPickingRef.current) return;
                            if (!editingRef.current) return;
                            const active = document.activeElement;
                            if (
                              active === formulaBarRef.current ||
                              active === cellInputRef.current
                            ) {
                              return;
                            }
                            if (
                              isFormulaValue(draftRef.current) &&
                              active instanceof Node &&
                              gridRef.current?.contains(active)
                            ) {
                              return;
                            }
                            commitEdit();
                          }, 0);
                        }}
                        onKeyDown={(event) => {
                          trackCaret(event.currentTarget);
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEdit("down");
                          }
                          if (event.key === "Tab") {
                            event.preventDefault();
                            commitEdit("right");
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="absolute inset-0 w-full select-text bg-card px-2 py-1 text-left font-sans text-sm text-foreground outline-none ring-2 ring-inset ring-ring"
                      />
                    ) : chip ? (
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${chip.className}`}
                      >
                        {chip.label}
                      </span>
                    ) : format?.link ? (
                      <a
                        href={format.link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="min-w-0 max-w-full truncate leading-8 text-primary underline"
                      >
                        {display || format.link}
                      </a>
                    ) : (
                      <span className={`min-w-0 max-w-full leading-8 ${format?.wrap ? "whitespace-pre-wrap" : format?.clip ? "overflow-hidden" : "truncate"}`}>
                        {display}
                      </span>
                    )}
                    {format?.note ? (
                      <span
                        title={format.note}
                        className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-warning"
                      />
                    ) : null}
                    {isFillCorner && !isEditing ? (
                      <span
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          dragRef.current = "fill";
                          fillOriginRef.current = range;
                        }}
                        className="absolute -bottom-1 -right-1 z-20 size-2 cursor-crosshair rounded-sm bg-primary"
                      />
                    ) : null}
                  </div>
                );
              })}

              <div className="border-b border-border" />
            </div>
          ))}

          <div className="grid" style={{ gridTemplateColumns }}>
            <button
              type="button"
              title="Add row"
              onClick={() => addRows(1)}
              className="sticky left-0 z-10 flex cursor-pointer items-center justify-center border-b border-r border-border bg-muted py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => addRows(20)}
              className="border-b border-border px-3 py-1 text-left text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
              style={{ gridColumn: "2 / -1" }}
            >
              + Add 20 more rows
            </button>
          </div>
        </div>
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-[#191B22] px-3 text-[11px]">
        <div className="flex min-w-0 items-end gap-1 pt-1">
          {(tabs ?? []).map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`flex items-center gap-1 rounded-t border border-b-0 px-2 py-1 ${
                  active
                    ? "border-[#7C66DC] bg-[#1F222B] text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60"
                }`}
              >
                {renamingTabId === tab.id ? (
                  <input
                    autoFocus
                    defaultValue={tab.name}
                    onBlur={(event) => {
                      onRenameTab?.(tab.id, event.target.value.trim() || tab.name);
                      setRenamingTabId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setRenamingTabId(null);
                    }}
                    className="w-24 rounded border border-ring bg-input/40 px-1 text-[11px] outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectTab?.(tab.id)}
                    onDoubleClick={() => setRenamingTabId(tab.id)}
                    className="max-w-28 truncate"
                  >
                    {tab.name}
                  </button>
                )}
                {(tabs?.length ?? 0) > 1 && (
                  <button
                    type="button"
                    title="Delete tab"
                    onClick={() => onDeleteTab?.(tab.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {onAddTab && (
            <button
              type="button"
              title="New Tab"
              onClick={onAddTab}
              className="mb-0.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono text-muted-foreground">
          <div>
            <span className="text-muted-foreground/70">Selected:</span>{" "}
            <span className="font-semibold text-foreground">{selectedAddress}</span>
          </div>
          <span className="h-3 w-px bg-border" />
          <div>
            <span className="text-muted-foreground/70">COUNT:</span>{" "}
            <span className="text-foreground">{stats.count}</span>
          </div>
          <div>
            <span className="text-muted-foreground/70">SUM:</span>{" "}
            <span className="font-semibold text-primary">
              {Number.isFinite(stats.sum) ? formatStat(stats.sum) : "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground/70">AVG:</span>{" "}
            <span className="text-foreground">
              {stats.average == null ? "—" : formatStat(stats.average)}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function formatStat(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}
