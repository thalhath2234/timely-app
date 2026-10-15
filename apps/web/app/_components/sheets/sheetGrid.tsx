"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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
import ListIcon from "lucide-react/dist/esm/icons/list.mjs";
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
import Palette from "lucide-react/dist/esm/icons/palette.mjs";
import Snowflake from "lucide-react/dist/esm/icons/snowflake.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.mjs";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ListFilter from "lucide-react/dist/esm/icons/list-filter.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import {
  SheetBorder,
  SheetCellFormat,
  SheetColumn,
  SheetColumnFormat,
  SheetColumnType,
  SheetConditionalFormat,
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
  type WorkbookTab,
} from "@timely/contract/sheetFormula";
import {
  cellFitsType,
  editTextForCell,
  isFormulaValue,
  normalizeTypedCell,
  typedEntryForColumn,
} from "@timely/contract/sheetCell";
import { conditionalStyles, formatSheetCell } from "@timely/contract/sheetDisplay";
import {
  applyStructureChange,
  conditionalSummaryRows,
  parseClipboardTable,
  pasteTable as pasteIntoGrid,
  seriesValues,
  sortGridRows,
  tableToClipboardText,
  type StructureChange,
} from "@timely/contract/sheetOps";
import { SHEET_FUNCTION_HELP } from "@timely/contract/sheetFunctions";
import {
  isBooleanTrue,
  newColumnId,
  newRowId,
  setCellFormat,
  isEmptyCellFormat,
  parseSelectOptions,
  syncSelectOptions,
  toggleNumberFormat,
} from "@/app/utils/sheetColumns";
import {
  columnTypeBadge,
  cellFormatFontFamily,
  cellTextDecoration,
  defaultAlign,
  statusChip,
} from "@/app/utils/sheetDisplay";
import {
  CellAddress,
  CellRange,
  clampAddress,
  activeCellInRange,
  coveredByMerge,
  findMerge,
  formulaOutputAddress,
  guessAggregateRange,
  hasMergeInRange,
  isExactMergeSelection,
  isInAnyRange,
  isInRange,
  isMergeOrigin,
  mergeAll,
  mergeFromRange,
  mergeHorizontally,
  mergeVertically,
  normalizedRange,
  rangeAddressLabel,
  rangeFromMerge,
  rangeTouchesCol,
  rangeTouchesRow,
  sameAddress,
  selectionAddressLabel,
  selectionStats,
  unmergeRange,
  visitRange,
} from "@timely/contract/sheetRange";
import {
  closeOpenParens,
  formulaAcceptsAnotherRange,
  formulaInputHint,
  insertFormulaRange,
  type FormulaRefSpan,
} from "@timely/contract/sheetFormulaInput";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useCellFit, useDecisionFeedback, type CellFitEdit } from "@/app/utils/hooks/decisions";
import {
  openContextMenu,
  tidyEntries,
  type ContextMenuEntry,
} from "@/app/_store/contextMenuStore";
import { controlClass } from "@/app/_components/_ui/field";
import { buttonClass } from "@/app/_components/_ui/button";
import DatePicker from "@/app/_components/_ui/datePicker";
import SheetColorSwatches, { SHEET_FILL_COLORS, SHEET_TEXT_COLORS } from "@/app/_components/sheets/sheetColorSwatches";
import SheetColumnSettings from "@/app/_components/sheets/sheetColumnSettings";
import SheetConditionalPanel from "@/app/_components/sheets/sheetConditionalPanel";
import SheetColumnFilter from "@/app/_components/sheets/sheetColumnFilter";
import { sheetPrintHtml } from "@/app/_components/sheets/sheetPrint";
import { plural } from "@/app/utils/plural";

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 640;
const ROW_HEADER_WIDTH = 52;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
/** Above this many rows only the rows in view are drawn. */
const VIRTUAL_ROWS = 120;
const OVERSCAN_ROWS = 24;
const ZOOM_OPTIONS = [50, 75, 90, 100, 125, 150, 200];
const FONT_SIZES = [10, 11, 12, 14, 18, 24];
const FUNCTION_NAMES = Object.keys(SHEET_FUNCTION_HELP);
/** Functions that take a range first, so the selection is filled in for them. */
const RANGE_FUNCTIONS = new Set(["SUM", "AVERAGE", "MIN", "MAX", "MEDIAN", "COUNT", "COUNTA", "COUNTBLANK", "PRODUCT", "AND", "OR", "STDEV", "UNIQUE", "SORT"]);
const FUNCTION_GROUPS = ["Math", "Conditional", "Lookup", "Logic", "Text", "Date"];
const functionTemplate = (name: string) => (range: string) => `=${name}(${RANGE_FUNCTIONS.has(name) ? range : ""})`;
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

export interface SheetGridChange {
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  frozenRows?: number;
  frozenCols?: number;
  conditionalFormats?: SheetConditionalFormat[];
}

type GridSnapshot = {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges: SheetMerge[];
  frozenRows: number;
  frozenCols: number;
  conditionalFormats: SheetConditionalFormat[];
  /** The insert/delete that produced the next state, so undo can reverse it in other tabs. */
  structure?: StructureChange;
};

export interface SheetTabItem {
  id: string;
  name: string;
  color?: string;
}

export interface SheetGridProps {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
  frozenRows?: number;
  frozenCols?: number;
  conditionalFormats?: SheetConditionalFormat[];
  /** Every tab, so formulas can read other tabs (`=SUM(January!H2:H)`). */
  workbook?: WorkbookTab[];
  /** `structure` says rows or columns moved, so formulas in other tabs must follow. */
  onChange: (next: SheetGridChange, meta?: { structure?: StructureChange }) => void;
  tabs?: SheetTabItem[];
  activeTabId?: string;
  onSelectTab?: (id: string) => void;
  onAddTab?: (event: ReactMouseEvent) => void;
  onRenameTab?: (id: string, name: string) => void;
  onDeleteTab?: (id: string) => void;
  onDuplicateTab?: (id: string) => void;
  onMoveTab?: (id: string, direction: -1 | 1) => void;
  onColorTab?: (id: string, color: string | undefined) => void;
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

let cellFitSeq = 0;

/** The edited cell to check against its column, or null when a typed column,
 * a formula or an unchanged entry leaves nothing to ask. */
function cellFitEdit(column: SheetColumn, rows: SheetRow[], rowIndex: number, value: string): CellFitEdit | null {
  const row = rows[rowIndex];
  if (!row || (column.type !== "text" && column.type !== "select")) return null;
  const entry = value.trim();
  if (!entry || isFormulaValue(entry) || entry === (row.cells?.[column.id] ?? "").trim()) return null;
  const values = new Set<string>();
  for (const other of rows) {
    if (other.id === row.id) continue;
    const v = (other.cells?.[column.id] ?? "").trim();
    if (v && !isFormulaValue(v)) values.add(v);
    if (values.size >= 50) break;
  }
  cellFitSeq += 1;
  return {
    id: cellFitSeq,
    rowId: row.id,
    columnId: column.id,
    input: { column: column.name, type: column.type, value: entry, values: [...values], options: column.options },
  };
}

function newBlankColumn(index: number): SheetColumn {
  return { id: newColumnId(), name: columnIndexToLetter(index), width: 160, type: "text" };
}

const GRID_MAKERS = { row: emptyRow, column: newBlankColumn };
const EMPTY_RULES: SheetConditionalFormat[] = [];
const TAB_COLORS = [
  { label: "Purple", value: "#6E56CF" },
  { label: "Blue", value: "#0090FF" },
  { label: "Teal", value: "#12A594" },
  { label: "Green", value: "#30A66D" },
  { label: "Amber", value: "#FFB224" },
  { label: "Orange", value: "#F76808" },
  { label: "Red", value: "#E5484D" },
  { label: "Pink", value: "#E93D82" },
];

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function inverseChange(change: StructureChange): StructureChange {
  return { ...change, kind: change.kind === "insert" ? "delete" : "insert" };
}

export default function SheetGrid({
  columns,
  rows,
  merges = [],
  frozenRows: frozenRowsProp = 0,
  frozenCols: frozenColsProp = 0,
  conditionalFormats = EMPTY_RULES,
  workbook,
  onChange: persist,
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onDuplicateTab,
  onMoveTab,
  onColorTab,
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
  const [optionsEditorIndex, setOptionsEditorIndex] = useState<number | null>(null);
  const [filterMenuIndex, setFilterMenuIndex] = useState<number | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [paintFormat, setPaintFormat] = useState<SheetCellFormat | null>(null);
  const [formulaRanges, setFormulaRanges] = useState<CellRange[]>([]);
  const [caret, setCaret] = useState(0);
  const [functionQuery, setFunctionQuery] = useState("");
  const [history, setHistory] = useState<{ past: GridSnapshot[]; future: GridSnapshot[] }>({
    past: [],
    future: [],
  });
  const [viewport, setViewport] = useState({ top: 0, height: 800 });

  const frozenRows = Math.min(frozenRowsProp, rows.length);
  const frozenCols = Math.min(frozenColsProp, columns.length);
  const selected = activeCellInRange(range, merges);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLInputElement>(null);
  const editSourceRef = useRef<"cell" | "formulaBar">("cell");
  const dragRef = useRef<
    "select" | "fill" | "formula" | "formula-col" | "formula-row" | null
  >(null);
  const fillOriginRef = useRef<CellRange | null>(null);
  /** Set by keyboard moves so the effect below scrolls the new cell into view. */
  const revealRef = useRef(false);
  const formulaPickOriginRef = useRef<CellAddress | null>(null);
  const formulaSpanRef = useRef<FormulaRefSpan | null>(null);
  const formulaPickingRef = useRef(false);
  const caretRef = useRef(0);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  /** What this grid last copied, so pasting it shifts formulas like a fill. */
  const clipboardRef = useRef<{ text: string; table: string[][]; origin: CellAddress; cut: boolean } | null>(null);
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
  const tabStripRef = useRef<HTMLDivElement>(null);

  // A workbook with many tabs scrolls its tab strip: keep the open tab in view.
  useEffect(() => {
    tabStripRef.current?.querySelector("[data-active-tab]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs?.length]);
  const [fitEdit, setFitEdit] = useState<CellFitEdit | null>(null);
  const [dismissedFit, setDismissedFit] = useState(0);
  const cellFit = useCellFit(fitEdit);
  const fitFeedback = useDecisionFeedback();

  const sheetName = tabs?.find((tab) => tab.id === activeTabId)?.name ?? "Sheet 1";

  const evaluator = useMemo(
    () =>
      createSheetEvaluator(
        columns,
        rows,
        workbook && activeTabId
          ? {
              tabs: workbook.map((tab) => (tab.id === activeTabId ? { ...tab, columns, rows } : tab)),
              currentTabId: activeTabId,
            }
          : undefined,
      ),
    [activeTabId, columns, rows, workbook],
  );

  const conditional = useMemo(
    () =>
      conditionalStyles(
        conditionalFormats,
        columns,
        rows.length,
        evaluator.valueAt,
        frozenRows,
        conditionalSummaryRows(conditionalFormats, rows, columns),
      ),
    [columns, conditionalFormats, evaluator, frozenRows, rows],
  );

  const snapshot = (): GridSnapshot => ({ columns, rows, merges, frozenRows, frozenCols, conditionalFormats });

  const commit = (next: SheetGridChange, meta?: { structure?: StructureChange }) => {
    setHistory((current) => ({
      past: [...current.past.slice(-79), { ...snapshot(), structure: meta?.structure }],
      future: [],
    }));
    if (next.rows) {
      // Dropdown columns learn new values as they are typed or pasted.
      const synced = syncSelectOptions(next.columns ?? columns, next.rows);
      if (synced.columns !== (next.columns ?? columns) || synced.rows !== next.rows) {
        persist({ ...next, columns: synced.columns, rows: synced.rows }, meta);
        return;
      }
    }
    persist(next, meta);
  };

  const restore = (state: GridSnapshot, structure?: StructureChange) => {
    persist(
      {
        columns: state.columns,
        rows: state.rows,
        merges: state.merges,
        frozenRows: state.frozenRows,
        frozenCols: state.frozenCols,
        conditionalFormats: state.conditionalFormats,
      },
      structure ? { structure } : undefined,
    );
  };

  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [...history.future, { ...snapshot(), structure: prev.structure }],
    });
    // Other tabs followed the insert/delete; undoing it walks them back.
    restore(prev, prev.structure ? inverseChange(prev.structure) : undefined);
  };

  const redo = () => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({
      past: [...history.past, { ...snapshot(), structure: next.structure }],
      future: history.future.slice(0, -1),
    });
    restore(next, next.structure);
  };

  const rawAt = (address: CellAddress) => {
    const column = columns[address.col];
    const row = rows[address.row];
    if (!column || !row) return "";
    return row.cells?.[column.id] ?? "";
  };

  /** Columns that are drawn, in order. Hidden columns keep their data. */
  const visibleCols = useMemo(() => {
    const shown = columns.flatMap((column, index) => (column.hidden ? [] : [index]));
    return shown.length ? shown : [0];
  }, [columns]);

  const stepCol = (col: number, delta: number) => {
    const position = visibleCols.indexOf(col);
    if (position < 0) {
      const after = visibleCols.find((index) => index > col);
      return after ?? visibleCols[visibleCols.length - 1];
    }
    return visibleCols[Math.max(0, Math.min(visibleCols.length - 1, position + delta))];
  };

  const textAt = (col: number, row: number) => {
    const column = columns[col];
    const cell = rows[row];
    if (!column || !cell) return "";
    return formatSheetCell(evaluator.valueAt(col, row), column, cell.cells?.[column.id] ?? "", cell.formats?.[column.id]);
  };

  const activeFilters = Object.entries(columnFilters).filter(([id]) => columns.some((column) => column.id === id));

  const visibleRows = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query && activeFilters.length === 0) return rows.map((_, index) => index);
    const filters = activeFilters.map(([id, allowed]) => ({
      col: columns.findIndex((column) => column.id === id),
      allowed: new Set(allowed),
    }));
    return rows.flatMap((row, index) => {
      // Frozen header and total rows always stay in view.
      if (index < frozenRows) return [index];
      if (filters.some(({ col, allowed }) => !allowed.has(textAt(col, index).trim()))) return [];
      if (!query) return [index];
      const haystack = columns
        .map((_, col) => textAt(col, index))
        .join("\u0001")
        .toLowerCase();
      return haystack.includes(query) ? [index] : [];
    });
    // textAt reads the evaluator, which changes with rows and columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, filterQuery, rows, evaluator, columnFilters, frozenRows]);
  const filtering = visibleRows.length !== rows.length || filterQuery.trim().length > 0;

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
    if (extend) {
      setRange((previous) => ({ ...previous, focus }));
      return;
    }
    const merge = findMerge(merges, focus);
    if (merge) {
      setRange(rangeFromMerge(merge));
      return;
    }
    setRange({ anchor: focus, focus });
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
    commit({
      rows: nextRows.map((row) => ({
        ...row,
        formats: row.formats && Object.keys(row.formats).length ? row.formats : undefined,
      })),
    });
  };

  const copySelection = (cut = false) => {
    const { minCol, maxCol, minRow, maxRow } = normalizedRange(range);
    const table: string[][] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      const line: string[] = [];
      for (let col = minCol; col <= maxCol; col += 1) {
        line.push(rawAt({ col, row }));
      }
      table.push(line);
    }
    const text = tableToClipboardText(table);
    clipboardRef.current = { text, table, origin: { col: minCol, row: minRow }, cut };
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const clearSelection = () => {
    patchCells((row, _address, column) => ({
      ...row,
      cells: { ...row.cells, [column.id]: "" },
    }));
  };

  const pasteTable = (table: string[][], origin: CellAddress, source?: CellAddress) => {
    if (table.length === 0) return;
    const bounds = normalizedRange(range);
    const multi = bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol;
    // One copied value pasted over a selection fills all of it.
    if (table.length === 1 && table[0].length === 1 && multi) {
      const value = table[0][0];
      patchCells((row, address, column) => {
        const next = !isFormulaValue(value)
          ? normalizeTypedCell(column.type, value)
          : source
            ? shiftFormula(value, address.col - source.col, address.row - source.row)
            : value;
        return { ...row, cells: { ...row.cells, [column.id]: next } };
      });
      return;
    }
    const result = pasteIntoGrid({ columns, rows }, table, origin, GRID_MAKERS, source);
    if (result.rows === 0) return;
    commit({
      columns: result.grid.columns !== columns ? result.grid.columns : undefined,
      rows: result.grid.rows,
    });
    setRange({ anchor: origin, focus: { col: origin.col + result.cols - 1, row: origin.row + result.rows - 1 } });
  };

  const pasteFromClipboard = async () => {
    const copied = clipboardRef.current;
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (text !== null && text !== "" && (!copied || text !== copied.text)) {
      pasteTable(parseClipboardTable(text), selected);
      return;
    }
    if (copied) {
      // Pasting a cut keeps formulas exactly as they were.
      pasteTable(copied.table, selected, copied.cut ? undefined : copied.origin);
    }
  };

  const applyFormat = (patch: Partial<SheetCellFormat>) => {
    patchCells((row, address, column) => ({
      ...row,
      formats: setCellFormat(row.formats, column.id, patch),
    }));
  };

  const setColumnFormat = (index: number, patch: Partial<SheetColumnFormat>) => {
    commit({
      columns: columns.map((column, columnIndex) => {
        if (columnIndex !== index) return column;
        const format: SheetColumnFormat = { ...(column.format ?? {}), ...patch };
        (Object.keys(format) as (keyof SheetColumnFormat)[]).forEach((key) => {
          if (format[key] === undefined || format[key] === "") delete format[key];
        });
        const next: SheetColumn = { ...column, format };
        if (Object.keys(format).length === 0) delete next.format;
        return next;
      }),
    });
  };

  const setColumnType = (index: number, type: SheetColumnType) => {
    const nextColumns = columns.map((column, columnIndex) => {
      if (columnIndex !== index) return column;
      const next: SheetColumn = { ...column, type };
      if (type !== "select") delete next.options;
      return next;
    });
    if (type === "select") {
      // Existing values become the first options so nothing is lost.
      const synced = syncSelectOptions(nextColumns, rows);
      commit({ columns: synced.columns, rows: synced.rows });
    } else {
      commit({ columns: nextColumns });
    }
    setTypeMenuIndex(null);
  };

  const saveSelectOptions = (index: number, text: string) => {
    const options = parseSelectOptions(text);
    const nextColumns = columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, options } : column,
    );
    const synced = syncSelectOptions(nextColumns, rows);
    commit({ columns: synced.columns, rows: synced.rows });
    setOptionsEditorIndex(null);
  };

  const openSelectMenu = (address: CellAddress) => {
    const column = columns[address.col];
    if (!column || column.type !== "select") return;
    const raw = rawAt(address);
    if (isFormulaValue(raw)) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(
      `[data-cell="${address.col}-${address.row}"]`,
    );
    const rect = cell?.getBoundingClientRect();
    if (!rect) return;
    const current = raw.trim();
    const options = column.options ?? [];
    const items = tidyEntries([
      ...options.map<ContextMenuEntry>((option) => ({
        kind: "action",
        label: option,
        checked: option === current,
        onSelect: () => setCellValue(address, option),
      })),
      { kind: "separator" },
      current !== "" && {
        kind: "action" as const,
        label: "Clear",
        onSelect: () => setCellValue(address, ""),
      },
      {
        kind: "action",
        label: "Add option…",
        icon: Plus,
        onSelect: () => startEditing(address, ""),
      },
      {
        kind: "action",
        label: "Edit options…",
        icon: Pencil,
        onSelect: () => setOptionsEditorIndex(address.col),
      },
    ]);
    openContextMenu({ x: rect.left, y: rect.bottom, items, title: column.name });
  };

  const toggleBoolean = (address: CellAddress) => {
    const current = rawAt(address);
    if (isFormulaValue(current)) return;
    setCellValue(address, isBooleanTrue(current) ? "FALSE" : "TRUE");
  };

  /** Inserts or deletes rows/columns; formulas here and in other tabs follow. */
  const changeStructure = (change: StructureChange) => {
    if (change.count <= 0) return;
    if (change.kind === "delete") {
      const total = change.axis === "row" ? rows.length : columns.length;
      if (total - change.count < 1) return;
    }
    const next = applyStructureChange(
      { name: sheetName, columns, rows, merges, frozenRows, frozenCols, conditionalFormats },
      change,
      GRID_MAKERS,
    );
    commit(
      {
        columns: next.columns,
        rows: next.rows,
        merges: next.merges,
        frozenRows: next.frozenRows ?? 0,
        frozenCols: next.frozenCols ?? 0,
        conditionalFormats: next.conditionalFormats ?? [],
      },
      { structure: change },
    );
    if (change.kind === "delete") {
      const limit = (change.axis === "row" ? rows.length : columns.length) - change.count - 1;
      const at = Math.max(0, Math.min(change.at, limit));
      setSelection(change.axis === "row" ? { col: selected.col, row: at } : { col: at, row: selected.row });
    }
  };

  const addColumn = (atIndex = columns.length, count = 1) =>
    changeStructure({ kind: "insert", axis: "col", at: atIndex, count });
  const deleteColumns = (at: number, count = 1) => changeStructure({ kind: "delete", axis: "col", at, count });
  const addRows = (count = 1, atIndex = rows.length) =>
    changeStructure({ kind: "insert", axis: "row", at: atIndex, count });
  const deleteRows = (at: number, count = 1) => changeStructure({ kind: "delete", axis: "row", at, count });

  const renameColumn = (index: number, name: string) => {
    commit({
      columns: columns.map((column, columnIndex) =>
        columnIndex === index
          ? { ...column, name: name.trim() || columnIndexToLetter(index) }
          : column,
      ),
    });
  };

  const setColumnsHidden = (indexes: number[], hidden: boolean) => {
    const targets = new Set(indexes);
    const next = columns.map((column, index) => {
      if (!targets.has(index)) return column;
      const copy: SheetColumn = { ...column };
      if (hidden) copy.hidden = true;
      else delete copy.hidden;
      return copy;
    });
    // At least one column stays visible.
    if (next.every((column) => column.hidden)) return;
    commit({ columns: next });
    if (hidden && targets.has(selected.col)) setSelection({ col: stepCol(Math.max(...indexes), 1), row: selected.row });
  };

  const setFrozen = (patch: { frozenRows?: number; frozenCols?: number }) => {
    commit(patch);
    setOpenMenu(null);
  };

  const sortByColumn = (index: number, direction: "asc" | "desc") => {
    const column = columns[index];
    if (!column) return;
    const bounds = normalizedRange(range);
    // A block of several rows sorts only those rows; otherwise the whole tab.
    const rowRange = bounds.maxRow > bounds.minRow ? { start: bounds.minRow, end: bounds.maxRow } : undefined;
    const sorted = sortGridRows(rows, columns, index, direction, evaluator.valueAt, { frozenRows, rowRange });
    if (sorted === rows) {
      setOpenMenu(null);
      return;
    }
    const first = rowRange?.start ?? frozenRows;
    const last = rowRange?.end ?? rows.length - 1;
    // Merges inside the sorted rows cannot follow them.
    const keptMerges = merges.filter(
      (merge) => merge.startRow + merge.rowSpan - 1 < first || merge.startRow > last,
    );
    commit({ rows: sorted, merges: keptMerges.length === merges.length ? undefined : keptMerges });
    setOpenMenu(null);
  };

  /** Drag-fill: continues number, date, month and "Item 1" series; formulas shift. */
  const fillRange = (from: CellRange, to: CellAddress) => {
    const source = normalizedRange(from);
    const target = normalizedRange({ anchor: from.anchor, focus: to });
    const vertical = target.minRow < source.minRow || target.maxRow > source.maxRow;
    const horizontal = !vertical && (target.minCol < source.minCol || target.maxCol > source.maxCol);
    if (!vertical && !horizontal) return;
    const nextRows = rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
      formats: { ...(row.formats ?? {}) },
    }));

    const write = (srcCol: number, srcRow: number, col: number, row: number, value: string) => {
      const sourceColumn = columns[srcCol];
      const targetColumn = columns[col];
      const sourceRow = rows[srcRow];
      const targetRow = nextRows[row];
      if (!sourceColumn || !targetColumn || !sourceRow || !targetRow) return;
      targetRow.cells[targetColumn.id] = isFormulaValue(value) ? value : normalizeTypedCell(targetColumn.type, value);
      const sourceFormat = sourceRow.formats?.[sourceColumn.id];
      if (sourceFormat) targetRow.formats[targetColumn.id] = sourceFormat;
      else delete targetRow.formats[targetColumn.id];
    };

    const lines = vertical
      ? Array.from({ length: source.maxCol - source.minCol + 1 }, (_, i) => source.minCol + i)
      : Array.from({ length: source.maxRow - source.minRow + 1 }, (_, i) => source.minRow + i);
    for (const line of lines) {
      const cells = vertical
        ? Array.from({ length: source.maxRow - source.minRow + 1 }, (_, i) => ({ col: line, row: source.minRow + i }))
        : Array.from({ length: source.maxCol - source.minCol + 1 }, (_, i) => ({ col: source.minCol + i, row: line }));
      const values = cells.map((cell) => rawAt(cell));
      const forward = vertical ? target.maxRow > source.maxRow : target.maxCol > source.maxCol;
      const count = vertical
        ? forward
          ? target.maxRow - source.maxRow
          : source.minRow - target.minRow
        : forward
          ? target.maxCol - source.maxCol
          : source.minCol - target.minCol;
      const series = seriesValues(values, count, !forward);
      for (let step = 1; step <= count; step += 1) {
        // Cells further from the source cycle through it, like a pattern.
        const cycle = forward ? (step - 1) % cells.length : cells.length - 1 - ((step - 1) % cells.length);
        const sourceCell = cells[cycle];
        const position = vertical
          ? { col: line, row: forward ? source.maxRow + step : source.minRow - step }
          : { col: forward ? source.maxCol + step : source.minCol - step, row: line };
        const raw = values[cycle];
        const value = isFormulaValue(raw)
          ? shiftFormula(raw, position.col - sourceCell.col, position.row - sourceCell.row)
          : series[step - 1];
        write(sourceCell.col, sourceCell.row, position.col, position.row, value);
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

  /** Copies the top row of the selection into the rows below it. */
  const fillDown = () => {
    const bounds = normalizedRange(range);
    if (bounds.maxRow === bounds.minRow) return;
    patchCells((row, address, column) => {
      if (address.row === bounds.minRow) return row;
      const sourceRow = rows[bounds.minRow];
      const raw = sourceRow.cells?.[column.id] ?? "";
      const value = isFormulaValue(raw) ? shiftFormula(raw, 0, address.row - bounds.minRow) : raw;
      const formats = { ...(row.formats ?? {}) };
      const sourceFormat = sourceRow.formats?.[column.id];
      if (sourceFormat) formats[column.id] = sourceFormat;
      return { ...row, cells: { ...row.cells, [column.id]: value }, formats };
    });
  };

  const startEditing = (
    address: CellAddress,
    initialValue?: string,
    source: "cell" | "formulaBar" = "cell",
  ) => {
    editSourceRef.current = source;
    formulaSpanRef.current = null;
    formulaPickOriginRef.current = null;
    setFormulaRanges([]);
    setSelection(address);
    const nextDraft = initialValue ?? editTextForCell(columns[address.col]?.type, rawAt(address));
    caretRef.current = nextDraft.length;
    setDraft(nextDraft);
    setEditing(address);
  };

  const clearFormulaPick = () => {
    formulaSpanRef.current = null;
    formulaPickOriginRef.current = null;
    formulaPickingRef.current = false;
    setFormulaRanges([]);
  };

  const commitEdit = (move: "down" | "right" | "none" = "none") => {
    const address = editingRef.current;
    if (!address) return;
    const startedInFormulaBar = editSourceRef.current === "formulaBar";
    const raw = draftRef.current;
    const column = columns[address.col];
    const value = isFormulaValue(raw) ? closeOpenParens(raw.trim()) : typedEntryForColumn(column?.type, raw);
    editingRef.current = null;
    const fit = column ? cellFitEdit(column, rows, address.row, normalizeTypedCell(column.type, value)) : null;
    if (fit) setFitEdit(fit);
    // Retyping a cell that had a hint counts as the hint being useful.
    if (cellFit?.logId && cellFit.id !== dismissedFit && column?.id === cellFit.columnId && rows[address.row]?.id === cellFit.rowId && value.trim() !== cellFit.value) {
      fitFeedback.mutate({ logId: cellFit.logId, accepted: true });
      setDismissedFit(cellFit.id);
    }
    setCellValue(address, value);
    setEditing(null);
    setDraft("");
    clearFormulaPick();
    if (move === "down") {
      const merge = findMerge(merges, address);
      const nextRow = merge ? merge.startRow + merge.rowSpan : address.row + 1;
      setSelection({ col: address.col, row: Math.min(nextRow, rows.length - 1) });
      revealRef.current = true;
    }
    if (move === "right") {
      const merge = findMerge(merges, address);
      const nextCol = merge ? merge.startCol + merge.colSpan - 1 : address.col;
      setSelection({ col: stepCol(Math.min(nextCol, columns.length - 1), 1), row: address.row });
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
    setCaret(caretRef.current);
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

  const applyFormulaRange = (picked: CellRange, mode: "replace" | "append" = "replace") => {
    const label = rangeAddressLabel(picked);
    const result = insertFormulaRange(
      draftRef.current,
      caretRef.current,
      label,
      formulaSpanRef.current,
      mode,
    );
    formulaSpanRef.current = result.span;
    caretRef.current = result.caret;
    setDraft(result.value);
    setFormulaRanges((previous) => {
      if (mode === "append") return [...previous, picked];
      if (previous.length === 0) return [picked];
      return [...previous.slice(0, -1), picked];
    });
    focusFormulaInput(result.caret);
    requestAnimationFrame(() => focusFormulaInput(result.caret));
  };

  const beginFormulaPick = (
    address: CellAddress,
    mode: "formula" | "formula-col" | "formula-row",
  ) => {
    const shouldAppend = formulaAcceptsAnotherRange(draftRef.current, formulaSpanRef.current);
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
    applyFormulaRange(picked, shouldAppend ? "append" : "replace");
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

  const isBlankAt = (col: number, row: number) => rawAt({ col, row }).trim() === "";

  /** Ctrl+Arrow: jump to the edge of the block of filled cells, like other spreadsheets. */
  const jumpTarget = (from: CellAddress, axis: "row" | "col", delta: 1 | -1): CellAddress => {
    if (axis === "row") {
      const list = visibleRows;
      let position = list.indexOf(from.row);
      if (position < 0) position = 0;
      const at = (p: number) => list[p];
      const last = delta > 0 ? list.length - 1 : 0;
      if (position === last) return from;
      const nextBlank = isBlankAt(from.col, at(position + delta));
      if (isBlankAt(from.col, from.row) || nextBlank) {
        // Skip blanks to the next filled cell (or the edge).
        let p = position + delta;
        while (p !== last && isBlankAt(from.col, at(p))) p += delta;
        return { col: from.col, row: at(p) };
      }
      let p = position;
      while (p !== last && !isBlankAt(from.col, at(p + delta))) p += delta;
      return { col: from.col, row: at(p) };
    }
    const list = visibleCols;
    let position = list.indexOf(from.col);
    if (position < 0) position = 0;
    const last = delta > 0 ? list.length - 1 : 0;
    if (position === last) return from;
    const nextBlank = isBlankAt(list[position + delta], from.row);
    if (isBlankAt(from.col, from.row) || nextBlank) {
      let p = position + delta;
      while (p !== last && isBlankAt(list[p], from.row)) p += delta;
      return { col: list[p], row: from.row };
    }
    let p = position;
    while (p !== last && !isBlankAt(list[p + delta], from.row)) p += delta;
    return { col: list[p], row: from.row };
  };

  const stepRow = (row: number, delta: number) => {
    const position = visibleRows.indexOf(row);
    if (position < 0) return visibleRows[0] ?? 0;
    return visibleRows[Math.max(0, Math.min(visibleRows.length - 1, position + delta))] ?? row;
  };

  const pageRows = () => Math.max(1, Math.floor((viewport.height - HEADER_HEIGHT) / ROW_HEIGHT) - 1);

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    // Keys typed into the column rename box or a column popover (which
    // bubble here through the portal) belong to that field, not the grid.
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.closest("input, textarea, select, [contenteditable='true']")) return;
    const extend = event.shiftKey;
    const mod = event.metaKey || event.ctrlKey;
    const nav = normalizedRange(range);
    const origin = extend ? range.focus : selected;
    const move = (target: CellAddress) => {
      event.preventDefault();
      revealRef.current = true;
      return setSelection(target, extend);
    };

    switch (event.key) {
      case "ArrowUp":
        if (mod) return move(jumpTarget(origin, "row", -1));
        return move({ col: origin.col, row: stepRow(extend ? range.focus.row : nav.minRow, -1) });
      case "ArrowDown":
        if (mod) return move(jumpTarget(origin, "row", 1));
        return move({ col: origin.col, row: stepRow(extend ? range.focus.row : nav.maxRow, 1) });
      case "ArrowLeft":
        if (mod) return move(jumpTarget(origin, "col", -1));
        return move({ col: stepCol(extend ? range.focus.col : nav.minCol, -1), row: origin.row });
      case "ArrowRight":
        if (mod) return move(jumpTarget(origin, "col", 1));
        return move({ col: stepCol(extend ? range.focus.col : nav.maxCol, 1), row: origin.row });
      case "Home":
        return move(mod ? { col: visibleCols[0], row: visibleRows[0] ?? 0 } : { col: visibleCols[0], row: origin.row });
      case "End":
        return move(
          mod
            ? { col: visibleCols[visibleCols.length - 1], row: visibleRows[visibleRows.length - 1] ?? 0 }
            : { col: visibleCols[visibleCols.length - 1], row: origin.row },
        );
      case "PageDown":
        return move({ col: origin.col, row: stepRow(origin.row, pageRows()) });
      case "PageUp":
        return move({ col: origin.col, row: stepRow(origin.row, -pageRows()) });
      case "Tab":
        event.preventDefault();
        revealRef.current = true;
        return setSelection({ col: stepCol(selected.col, event.shiftKey ? -1 : 1), row: selected.row });
      case "Enter":
      case "F2": {
        event.preventDefault();
        const column = columns[selected.col];
        if (
          event.key === "Enter" &&
          column?.type === "select" &&
          !isFormulaValue(rawAt(selected))
        ) {
          return openSelectMenu(selected);
        }
        return startEditing(selected);
      }
      case "Delete":
      case "Backspace":
        event.preventDefault();
        return patchCells((row, _address, column) => ({
          ...row,
          cells: { ...row.cells, [column.id]: "" },
        }));
      case "a":
      case "A":
        if (mod) {
          event.preventDefault();
          return setSelection({
            anchor: { col: 0, row: 0 },
            focus: { col: columns.length - 1, row: rows.length - 1 },
          });
        }
        break;
      case "d":
      case "D":
        if (mod) {
          event.preventDefault();
          return fillDown();
        }
        break;
      case "z":
      case "Z":
        if (mod) {
          event.preventDefault();
          return event.shiftKey ? redo() : undo();
        }
        break;
      case "y":
      case "Y":
        if (mod) {
          event.preventDefault();
          return redo();
        }
        break;
      case "c":
      case "C":
        if (mod) {
          event.preventDefault();
          copySelection();
          return;
        }
        break;
      case "x":
      case "X":
        if (mod) {
          event.preventDefault();
          copySelection(true);
          clearSelection();
          return;
        }
        break;
      case "v":
      case "V":
        if (mod) {
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
        if (mod) {
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
    if (openMenu == null && typeMenuIndex == null && optionsEditorIndex == null && filterMenuIndex == null) return;
    const closeAll = () => {
      setOpenMenu(null);
      setTypeMenuIndex(null);
      setOptionsEditorIndex(null);
      setFilterMenuIndex(null);
    };
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // Kit dropdowns and the date picker open in their own layer.
      if (target?.closest("[data-sheet-popover], [data-select-portal], [role='dialog'], [role='listbox']")) return;
      closeAll();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) return;
      closeAll();
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [editing, filterMenuIndex, openMenu, optionsEditorIndex, typeMenuIndex]);

  // Track the scroll window so long sheets only draw the rows in view.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewport((current) =>
        current.top === element.scrollTop && current.height === element.clientHeight
          ? current
          : { top: element.scrollTop, height: element.clientHeight },
      );
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Keyboard moves keep the active cell in view, under the frozen rows and columns.
  useEffect(() => {
    if (!revealRef.current) return;
    revealRef.current = false;
    const element = gridRef.current;
    if (!element) return;
    const focus = range.focus;
    const position = visibleRows.indexOf(focus.row);
    if (position >= 0 && focus.row >= frozenRows) {
      const frozenHeight = frozenRows * ROW_HEIGHT;
      const top = HEADER_HEIGHT + position * ROW_HEIGHT;
      if (top - HEADER_HEIGHT - frozenHeight < element.scrollTop) {
        element.scrollTop = top - HEADER_HEIGHT - frozenHeight;
      } else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
      }
    }
    const colPosition = visibleCols.indexOf(focus.col);
    if (colPosition >= 0 && colPosition >= frozenCols) {
      let left = ROW_HEADER_WIDTH;
      let frozenWidth = 0;
      for (const index of visibleCols.slice(0, colPosition)) left += columns[index].width;
      for (const index of visibleCols.slice(0, Math.min(frozenCols, visibleCols.length))) frozenWidth += columns[index].width;
      const width = columns[focus.col]?.width ?? 0;
      if (left - ROW_HEADER_WIDTH - frozenWidth < element.scrollLeft) {
        element.scrollLeft = left - ROW_HEADER_WIDTH - frozenWidth;
      } else if (left + width > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = left + width - element.clientWidth;
      }
    }
  }, [columns, frozenCols, frozenRows, range.focus, visibleCols, visibleRows]);

  const commitEditRef = useRef(commitEdit);
  useEffect(() => {
    commitEditRef.current = commitEdit;
  });

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
      commitEditRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [editing]);

  // The last track takes the spare width so wide screens have no empty band.
  const gridTemplateColumns = `${ROW_HEADER_WIDTH}px ${visibleCols
    .map((index) => `${columns[index].width}px`)
    .join(" ")} minmax(40px, 1fr)`;

  /** Left offsets of frozen columns, which stick beside the row numbers. */
  const stickyLeft = new Map<number, number>();
  let frozenOffset = ROW_HEADER_WIDTH;
  for (const index of visibleCols) {
    if (index >= frozenCols) break;
    stickyLeft.set(index, frozenOffset);
    frozenOffset += columns[index].width;
  }
  const lastFrozenCol = stickyLeft.size ? Math.max(...stickyLeft.keys()) : -1;

  /** Hidden columns sitting just before each visible one, for the "show" chip. */
  const hiddenBeforeCol = new Map<number, number[]>();
  let pendingHidden: number[] = [];
  columns.forEach((column, index) => {
    if (column.hidden) {
      pendingHidden.push(index);
      return;
    }
    if (pendingHidden.length) hiddenBeforeCol.set(index, pendingHidden);
    pendingHidden = [];
  });
  if (pendingHidden.length && visibleCols.length) {
    // Hidden columns at the far right show their chip on the last visible column.
    const last = visibleCols[visibleCols.length - 1];
    hiddenBeforeCol.set(last, [...(hiddenBeforeCol.get(last) ?? []), ...pendingHidden]);
  }

  /** How many drawn tracks a merge covers once hidden columns are left out. */
  const visibleSpan = (startCol: number, colSpan: number) => {
    let count = 0;
    for (let col = startCol; col < startCol + colSpan; col += 1) if (!columns[col]?.hidden) count += 1;
    return Math.max(1, count);
  };

  // Long sheets draw only the rows in view (plus a margin); spacers keep the scroll height.
  const frozenCount = visibleRows.filter((row) => row < frozenRows).length;
  const bodyRows = visibleRows.slice(frozenCount);
  let startPos = 0;
  let endPos = bodyRows.length - 1;
  if (bodyRows.length > VIRTUAL_ROWS) {
    const scale = zoom / 100 || 1;
    const top = viewport.top / Math.max(scale, 1);
    const first = Math.floor(top / ROW_HEIGHT) - frozenCount;
    const inView = Math.ceil(viewport.height / (ROW_HEIGHT * Math.min(scale, 1)));
    startPos = Math.max(0, first - OVERSCAN_ROWS);
    endPos = Math.min(bodyRows.length - 1, first + inView + OVERSCAN_ROWS);
    // Keep the start of a tall merge that reaches into view.
    const firstRow = bodyRows[startPos];
    if (!filtering && firstRow !== undefined) {
      for (const merge of merges) {
        if (merge.rowSpan > 1 && merge.startRow < firstRow && merge.startRow + merge.rowSpan - 1 >= firstRow) {
          const position = bodyRows.indexOf(merge.startRow);
          if (position >= 0 && position < startPos) startPos = position;
        }
      }
    }
  }
  const renderRows = [...visibleRows.slice(0, frozenCount), ...bodyRows.slice(startPos, endPos + 1)];
  const topSpacer = startPos * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, bodyRows.length - 1 - endPos) * ROW_HEIGHT;

  /** Double-clicking a column edge sizes it to its longest shown value. */
  const autoFitColumn = (index: number) => {
    const column = columns[index];
    if (!column) return;
    let longest = column.name.length + 4;
    const limit = Math.min(rows.length, 2000);
    for (let row = 0; row < limit; row += 1) longest = Math.max(longest, textAt(index, row).length);
    const width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(longest * 7.4 + 28)));
    if (width !== column.width) commit({ columns: columns.map((item, i) => (i === index ? { ...item, width } : item)) });
  };

  const hint = editing ? formulaInputHint(draft, caret, FUNCTION_NAMES) : null;
  const currentHelp = hint?.current ? SHEET_FUNCTION_HELP[hint.current.name] : undefined;

  const acceptSuggestion = (name: string) => {
    if (!hint?.word) return;
    const next = `${draft.slice(0, hint.word.start)}${name}(${draft.slice(hint.word.end)}`;
    const position = hint.word.start + name.length + 1;
    formulaSpanRef.current = null;
    setDraft(next);
    draftRef.current = next;
    caretRef.current = position;
    setCaret(position);
    requestAnimationFrame(() => focusFormulaInput(position));
  };

  /** Tab picks the first suggested function while typing a formula. */
  const handleHintKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && hint?.suggestions.length) {
      event.preventDefault();
      acceptSuggestion(hint.suggestions[0]);
      return true;
    }
    return false;
  };

  const fitRow = cellFit ? rows.findIndex((row) => row.id === cellFit.rowId) : -1;
  const fitCol = cellFit ? columns.findIndex((column) => column.id === cellFit.columnId) : -1;
  // The hint shows while the cell still holds the entry it is about.
  const fitHint =
    cellFit &&
    cellFit.id !== dismissedFit &&
    fitRow >= 0 &&
    fitCol >= 0 &&
    (rows[fitRow].cells?.[cellFit.columnId] ?? "").trim() === cellFit.value
      ? { ...cellFit, address: `${columnIndexToLetter(fitCol)}${fitRow + 1}` }
      : null;

  const selectedRaw = rawAt(selected);
  const selectedAddress = selectionAddressLabel(range, merges);
  const selectedFormat = formatAt(rows[selected.row], columns[selected.col]?.id);
  const stats = selectionStats(
    range,
    (address) => {
      const result = evaluator.valueAt(address.col, address.row);
      return result.type === "number" ? result.value : null;
    },
    (address) => rawAt(address).trim() === "",
  );

  const bounds = normalizedRange(range);
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

  const insertFormula = (template: (rangeLabel: string) => string, usesRange = true) => {
    const multi = usesRange && !sameAddress(range.anchor, range.focus);
    const guessed =
      usesRange && !multi && rawAt(selected).trim() === ""
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
        setFormulaRanges([picked]);
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

  /** The block of rows (or columns) a menu acts on: the selection when the click is inside it. */
  const spanFor = (axis: "row" | "col", index: number) => {
    const first = axis === "row" ? bounds.minRow : bounds.minCol;
    const last = axis === "row" ? bounds.maxRow : bounds.maxCol;
    return index >= first && index <= last ? { at: first, count: last - first + 1 } : { at: index, count: 1 };
  };

  const rowEntries = (index: number): ContextMenuEntry[] => {
    const span = spanFor("row", index);
    const label = span.count === 1 ? `row ${span.at + 1}` : `rows ${span.at + 1}–${span.at + span.count}`;
    return [
      {
        kind: "action",
        label: `Insert ${plural(span.count, "row")} above`,
        icon: BetweenHorizontalStart,
        onSelect: () => addRows(span.count, span.at),
      },
      {
        kind: "action",
        label: `Insert ${plural(span.count, "row")} below`,
        icon: BetweenHorizontalEnd,
        onSelect: () => addRows(span.count, span.at + span.count),
      },
      {
        kind: "action",
        label: frozenRows === span.at + span.count ? "Unfreeze rows" : `Freeze up to row ${span.at + span.count}`,
        icon: Snowflake,
        onSelect: () => setFrozen({ frozenRows: frozenRows === span.at + span.count ? 0 : span.at + span.count }),
      },
      {
        kind: "action",
        label: `Delete ${label}`,
        icon: Minus,
        disabled: rows.length - span.count < 1,
        danger: true,
        onSelect: () => deleteRows(span.at, span.count),
      },
    ];
  };

  const columnEntries = (index: number): ContextMenuEntry[] => {
    const span = spanFor("col", index);
    const letters =
      span.count === 1
        ? columnIndexToLetter(span.at)
        : `${columnIndexToLetter(span.at)}–${columnIndexToLetter(span.at + span.count - 1)}`;
    const indexes = Array.from({ length: span.count }, (_, i) => span.at + i);
    return [
      {
        kind: "action",
        label: `Insert ${plural(span.count, "column")} left`,
        icon: BetweenVerticalStart,
        onSelect: () => addColumn(span.at, span.count),
      },
      {
        kind: "action",
        label: `Insert ${plural(span.count, "column")} right`,
        icon: BetweenVerticalEnd,
        onSelect: () => addColumn(span.at + span.count, span.count),
      },
      {
        kind: "action",
        label: span.count === 1 ? "Hide column" : `Hide columns ${letters}`,
        icon: EyeOff,
        disabled: visibleCols.length - span.count < 1,
        onSelect: () => setColumnsHidden(indexes, true),
      },
      {
        kind: "action",
        label:
          frozenCols === span.at + span.count
            ? "Unfreeze columns"
            : `Freeze up to column ${columnIndexToLetter(span.at + span.count - 1)}`,
        icon: Snowflake,
        onSelect: () => setFrozen({ frozenCols: frozenCols === span.at + span.count ? 0 : span.at + span.count }),
      },
      {
        kind: "action",
        label: span.count === 1 ? "Delete column" : `Delete columns ${letters}`,
        icon: Trash2,
        disabled: columns.length - span.count < 1,
        danger: true,
        onSelect: () => deleteColumns(span.at, span.count),
      },
    ];
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
        onSelect: () => {
          copySelection(true);
          clearSelection();
        },
      },
      {
        kind: "action",
        label: "Copy",
        icon: ClipboardCopy,
        onSelect: () => copySelection(),
      },
      {
        kind: "action",
        label: "Paste",
        icon: ClipboardPaste,
        onSelect: () => void pasteFromClipboard(),
      },
      {
        kind: "action",
        label: "Clear",
        onSelect: clearSelection,
      },
      bounds.maxRow > bounds.minRow && {
        kind: "action" as const,
        label: "Fill down",
        icon: ArrowDown,
        onSelect: fillDown,
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Edit cell",
        icon: Pencil,
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
      { kind: "submenu", label: "Rows", icon: BetweenHorizontalStart, items: rowEntries(address.row) },
      { kind: "submenu", label: "Columns", icon: BetweenVerticalStart, items: columnEntries(address.col) },
    ]);
  };

  const columnMenu = (index: number): ContextMenuEntry[] => {
    const column = columns[index];
    const filtered = Boolean(column && columnFilters[column.id]);
    return tidyEntries([
      {
        kind: "action",
        label: "Rename column",
        icon: Pencil,
        onSelect: () => setRenamingColumnIndex(index),
      },
      {
        kind: "action",
        label: "Type and format…",
        icon: Settings2,
        onSelect: () => setTypeMenuIndex(index),
      },
      column?.type === "select" && {
        kind: "action" as const,
        label: "Edit dropdown options…",
        icon: ChevronDown,
        onSelect: () => setOptionsEditorIndex(index),
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
      {
        kind: "action",
        label: "Filter by values…",
        icon: ListFilter,
        onSelect: () => setFilterMenuIndex(index),
      },
      filtered && {
        kind: "action" as const,
        label: "Clear this filter",
        onSelect: () => setColumnFilters((current) => withoutKey(current, column!.id)),
      },
      { kind: "separator" },
      ...columnEntries(index),
    ]);
  };

  const rowMenu = (index: number): ContextMenuEntry[] => tidyEntries(rowEntries(index));

  const printSheet = () => {
    const markup = sheetPrintHtml({
      title: sheetName,
      columns,
      visibleCols,
      rows,
      visibleRows,
      merges: filtering ? [] : merges,
      displayAt: textAt,
      conditional,
    });
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
    frameDocument.write(markup);
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
  const toolClass = (active = false) =>
    `flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35 ${
      active ? "bg-accent text-foreground" : "text-muted-foreground"
    }`;

  const toggleMenu = (name: string) => {
    setTypeMenuIndex(null);
    setOpenMenu((current) => (current === name ? null : name));
  };

  return (
    <div data-chat-sheet-range={selectedAddress} data-chat-sheet-tab={activeTabId} className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-[#191B22] px-2 py-1">
        <button type="button" title="Undo" disabled={history.past.length === 0} onClick={undo} className={toolClass()}>
          <Undo2 className="size-4" />
        </button>
        <button type="button" title="Redo" disabled={history.future.length === 0} onClick={redo} className={toolClass()}>
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
        <button type="button" title="Bold" onClick={() => applyFormat({ bold: !selectedFormat?.bold })} className={toolClass(Boolean(selectedFormat?.bold))}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" title="Italic" onClick={() => applyFormat({ italic: !selectedFormat?.italic })} className={toolClass(Boolean(selectedFormat?.italic))}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" title="Underline" onClick={() => applyFormat({ underline: !selectedFormat?.underline })} className={toolClass(Boolean(selectedFormat?.underline))}>
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
            <div className="absolute left-0 top-8 z-40 rounded-lg border border-border bg-popover p-2 shadow-xl">
              <SheetColorSwatches
                colors={SHEET_TEXT_COLORS}
                value={selectedFormat?.textColor}
                noneLabel="Default"
                onPick={(color) => {
                  applyFormat({ textColor: color });
                  setOpenMenu(null);
                }}
              />
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button type="button" title="Fill color" onClick={() => toggleMenu("fill")} className={toolClass(openMenu === "fill")}>
            <Highlighter className="size-3.5" />
          </button>
          {openMenu === "fill" && (
            <div className="absolute left-0 top-8 z-40 rounded-lg border border-border bg-popover p-2 shadow-xl">
              <SheetColorSwatches
                colors={SHEET_FILL_COLORS}
                value={selectedFormat?.fillColor}
                noneLabel="No fill"
                onPick={(color) => {
                  applyFormat({ fillColor: color });
                  setOpenMenu(null);
                }}
              />
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
                className={controlClass("sm", "w-full")}
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
                  className={buttonClass({ variant: "secondary", size: "sm" })}
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
                className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
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
          <button type="button" title="Filter & sort" onClick={() => toggleMenu("filter")} className={toolClass(openMenu === "filter" || Boolean(filterQuery) || activeFilters.length > 0)}>
            <Filter className="size-3.5" />
          </button>
          {openMenu === "filter" && (
            <div className="absolute right-0 top-8 z-40 w-60 rounded-lg border border-border bg-popover p-2 shadow-xl">
              <input
                autoFocus
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Show rows containing…"
                className={controlClass("sm", "w-full")}
              />
              <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
                {filtering
                  ? `Showing ${visibleRows.length} of ${plural(rows.length, "row")}`
                  : `Sorts by column ${columnIndexToLetter(selected.col)}. Right-click a column to filter by its values.`}
              </p>
              {activeFilters.length > 0 || filterQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilterQuery("");
                    setColumnFilters({});
                  }}
                  className="mt-1 w-full rounded-md px-1 py-1 text-left text-[11px] text-primary hover:bg-accent/60"
                >
                  Clear all filters
                </button>
              ) : null}
              <div className="mt-2 flex gap-1">
                <button type="button" onClick={() => sortByColumn(selected.col, "asc")} className={buttonClass({ variant: "secondary", size: "sm", className: "flex-1" })}>
                  Sort A → Z
                </button>
                <button type="button" onClick={() => sortByColumn(selected.col, "desc")} className={buttonClass({ variant: "secondary", size: "sm", className: "flex-1" })}>
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
            <div className="absolute right-0 top-8 z-40 flex max-h-96 w-72 flex-col rounded-lg border border-border bg-popover p-1.5 shadow-xl">
              <input
                autoFocus
                value={functionQuery}
                onChange={(event) => setFunctionQuery(event.target.value)}
                placeholder="Search functions"
                aria-label="Search functions"
                className={controlClass("sm", "mb-1 w-full shrink-0 text-xs")}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {FUNCTION_GROUPS.map((group) => {
                  const query = functionQuery.trim().toLowerCase();
                  const names = FUNCTION_NAMES.filter(
                    (name) =>
                      SHEET_FUNCTION_HELP[name].group === group &&
                      (!query ||
                        name.toLowerCase().includes(query) ||
                        SHEET_FUNCTION_HELP[name].summary.toLowerCase().includes(query)),
                  );
                  if (names.length === 0) return null;
                  return (
                    <div key={group} className="mb-1">
                      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                      {names.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => insertFormula(functionTemplate(name), RANGE_FUNCTIONS.has(name))}
                          className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-accent"
                        >
                          <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{name}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{SHEET_FUNCTION_HELP[name].summary}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Colour rules"
            onClick={() => toggleMenu("rules")}
            className={toolClass(openMenu === "rules" || conditionalFormats.length > 0)}
          >
            <Palette className="size-3.5" />
          </button>
          {openMenu === "rules" && (
            <div className="absolute right-0 top-8 z-40 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
              <SheetConditionalPanel
                columns={columns}
                rules={conditionalFormats}
                defaultColumnId={columns[selected.col]?.id}
                onChange={(next) => commit({ conditionalFormats: next })}
              />
            </div>
          )}
        </div>
        <div className="relative" data-sheet-popover>
          <button
            type="button"
            title="Freeze rows and columns"
            onClick={() => toggleMenu("freeze")}
            className={toolClass(openMenu === "freeze" || frozenRows > 0 || frozenCols > 0)}
          >
            <Snowflake className="size-3.5" />
          </button>
          {openMenu === "freeze" && (
            <div className={`${POPOVER_PANEL} right-0 top-8 w-52`}>
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rows</p>
              {[0, 1, 2].map((count) => (
                <button key={`r${count}`} type="button" onClick={() => setFrozen({ frozenRows: count })} className={`${POPOVER_ITEM} ${frozenRows === count ? "bg-accent" : ""}`}>
                  {count === 0 ? "No rows" : plural(count, "row")}
                </button>
              ))}
              {selected.row + 1 > 2 ? (
                <button type="button" onClick={() => setFrozen({ frozenRows: selected.row + 1 })} className={`${POPOVER_ITEM} ${frozenRows === selected.row + 1 ? "bg-accent" : ""}`}>
                  Up to row {selected.row + 1}
                </button>
              ) : null}
              <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Columns</p>
              {[0, 1, 2].map((count) => (
                <button key={`c${count}`} type="button" onClick={() => setFrozen({ frozenCols: count })} className={`${POPOVER_ITEM} ${frozenCols === count ? "bg-accent" : ""}`}>
                  {count === 0 ? "No columns" : plural(count, "column")}
                </button>
              ))}
              {selected.col + 1 > 2 ? (
                <button type="button" onClick={() => setFrozen({ frozenCols: selected.col + 1 })} className={`${POPOVER_ITEM} ${frozenCols === selected.col + 1 ? "bg-accent" : ""}`}>
                  Up to column {columnIndexToLetter(selected.col)}
                </button>
              ) : null}
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
        <button type="button" title="Delete column" disabled={columns.length <= 1} onClick={() => { const span = spanFor("col", selected.col); deleteColumns(span.at, span.count); }} className={toolClass()}>
          <Minus className="size-3.5" />
        </button>
        <button type="button" title="Add row before" onClick={() => addRows(1, selected.row)} className={toolClass()}>
          <BetweenHorizontalStart className="size-3.5" />
        </button>
        <button type="button" title="Add row after" onClick={() => addRows(1, selected.row + 1)} className={toolClass()}>
          <BetweenHorizontalEnd className="size-3.5" />
        </button>
        <button type="button" title="Delete row" disabled={rows.length <= 1} onClick={() => { const span = spanFor("row", selected.row); deleteRows(span.at, span.count); }} className={toolClass()}>
          <Minus className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-[#191B22] px-3 py-1.5" data-formula-bar>
        <span className="w-16 shrink-0 rounded-md border border-[#7C66DC] bg-[#6E56CF] px-2 py-1 text-center font-mono text-xs font-semibold text-white shadow-[0_0_12px_rgba(110,86,207,0.2)]">
          {selectedAddress}
        </span>
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-card shadow-xs px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
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
              setFormulaRanges([]);
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
              if (handleHintKey(event)) return;
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
      {hint && (hint.suggestions.length > 0 || currentHelp) ? (
        <div className="flex min-h-7 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-[#15171D] px-3 py-1 text-[11px]" data-formula-bar>
          {hint.suggestions.length > 0 ? (
            <>
              {hint.suggestions.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptSuggestion(name);
                  }}
                  title={SHEET_FUNCTION_HELP[name]?.summary}
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono ${index === 0 ? "bg-[#2A2445] text-[#C4B5FD]" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                >
                  {name}
                </button>
              ))}
            </>
          ) : currentHelp ? (
            <>
              <span className="shrink-0 font-mono text-[#C4B5FD]">{currentHelp.signature}</span>
              <span className="min-w-0 truncate text-muted-foreground">{currentHelp.summary}</span>
            </>
          ) : null}
        </div>
      ) : null}

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
            style={{ gridTemplateColumns, height: HEADER_HEIGHT }}
          >
            <div className="sticky left-0 z-30 flex items-center justify-center border-b border-r border-border bg-muted font-mono text-[10px] text-muted-foreground">
              #
            </div>

            {visibleCols.map((index) => {
              const column = columns[index];
              const hiddenBefore = hiddenBeforeCol.get(index) ?? [];
              const frozenLeft = stickyLeft.get(index);
              const filtered = Boolean(columnFilters[column.id]);
              return (
              <div
                key={column.id}
                onContextMenu={(event) => {
                  if (index < bounds.minCol || index > bounds.maxCol) {
                    setSelection({ col: index, row: selected.row });
                  }
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
                data-column-header
                onMouseEnter={() => {
                  if (dragRef.current === "formula-col") {
                    extendFormulaPick({ col: index, row: 0 });
                  }
                }}
                className={`group relative flex min-w-0 items-center gap-1.5 border-b border-r border-border bg-muted px-2 ${
                  index >= bounds.minCol && index <= bounds.maxCol ? "bg-accent/60" : ""
                } ${
                  formulaRanges.some((picked) => rangeTouchesCol(picked, index))
                    ? "outline outline-dashed outline-primary/70"
                    : ""
                } ${index === lastFrozenCol ? "border-r-2 border-r-[#7C66DC]/60" : ""}`}
                style={frozenLeft !== undefined ? { position: "sticky", left: frozenLeft, zIndex: 25 } : undefined}
              >
                {hiddenBefore.length > 0 ? (
                  <button
                    type="button"
                    title={`Show ${plural(hiddenBefore.length, "hidden column")}`}
                    aria-label={`Show ${plural(hiddenBefore.length, "hidden column")}`}
                    onClick={() => setColumnsHidden(hiddenBefore, false)}
                    className="absolute -left-2 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-[#7C66DC] bg-[#2A2445] text-[#C4B5FD] hover:bg-[#6E56CF] hover:text-white"
                  >
                    <Eye className="size-2.5" />
                  </button>
                ) : null}
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
                      setSelection({
                        anchor: { col: index, row: 0 },
                        focus: { col: index, row: rows.length - 1 },
                      });
                    }}
                    title={`${column.name} · double-click to rename`}
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground"
                  >
                    {column.name}
                  </button>
                )}

                {filtered ? (
                  <button
                    type="button"
                    title="Filtered · change filter"
                    aria-label="Change filter"
                    onClick={() => setFilterMenuIndex(index)}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-[#C4B5FD] hover:bg-accent"
                  >
                    <ListFilter className="size-3" />
                  </button>
                ) : null}

                <div className="relative shrink-0" data-sheet-popover>
                  <button
                    type="button"
                    title="Column type and format"
                    onClick={() =>
                      setTypeMenuIndex((current) => (current === index ? null : index))
                    }
                    className="rounded border border-border bg-background/60 px-1 font-mono text-[9px] uppercase text-muted-foreground hover:bg-accent"
                  >
                    {columnTypeBadge(column.type)}
                  </button>
                  {typeMenuIndex === index ? (
                    <AnchoredPopover
                      boundsRef={gridRef}
                      className="rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                    >
                      <SheetColumnSettings
                        column={column}
                        onType={(type) => setColumnType(index, type)}
                        onFormat={(patch) => setColumnFormat(index, patch)}
                        onEditOptions={() => {
                          setTypeMenuIndex(null);
                          setOptionsEditorIndex(index);
                        }}
                      />
                    </AnchoredPopover>
                  ) : null}
                  {filterMenuIndex === index ? (
                    <AnchoredPopover
                      boundsRef={gridRef}
                      className="rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                    >
                      <SheetColumnFilter
                        columnName={column.name}
                        values={rows.slice(frozenRows).map((_, offset) => textAt(index, offset + frozenRows).trim())}
                        selected={columnFilters[column.id] ?? null}
                        onClose={() => setFilterMenuIndex(null)}
                        onApply={(allowed) => {
                          setColumnFilters((current) =>
                            allowed ? { ...current, [column.id]: allowed } : withoutKey(current, column.id),
                          );
                          setFilterMenuIndex(null);
                        }}
                      />
                    </AnchoredPopover>
                  ) : null}
                  {optionsEditorIndex === index ? (
                    <AnchoredPopover
                      boundsRef={gridRef}
                      className="w-64 rounded-md border border-border bg-popover p-2 shadow-lg"
                    >
                      <p className="mb-1 text-[11px] font-medium text-foreground">
                        Dropdown options
                      </p>
                      <textarea
                        autoFocus
                        defaultValue={(column.options ?? []).join("\n")}
                        placeholder={"One option per line"}
                        rows={6}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setOptionsEditorIndex(null);
                          }
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            saveSelectOptions(index, event.currentTarget.value);
                          }
                        }}
                        className="w-full resize-y rounded-md border border-input bg-card shadow-xs px-2 py-1 text-xs outline-none focus:border-ring"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Values already in the column stay listed.
                      </p>
                      <div className="mt-2 flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setOptionsEditorIndex(null)}
                          className="rounded px-2 py-1 text-[11px] hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            const textarea = event.currentTarget
                              .closest("[data-sheet-popover]")
                              ?.querySelector("textarea");
                            saveSelectOptions(index, textarea?.value ?? "");
                          }}
                          className={buttonClass({ size: "sm" })}
                        >
                          Save
                        </button>
                      </div>
                    </AnchoredPopover>
                  ) : null}
                </div>

                <span
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize · double-click to fit"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    // One undo step for the whole drag.
                    setHistory((current) => ({ past: [...current.past.slice(-79), snapshot()], future: [] }));
                    resizeStateRef.current = {
                      index,
                      startX: event.clientX,
                      startWidth: column.width,
                    };
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    autoFitColumn(index);
                  }}
                  className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary"
                />
              </div>
              );
            })}

            <button
              type="button"
              title="Add column"
              onClick={() => addColumn()}
              className="flex cursor-pointer items-center justify-start border-b border-border pl-3 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              +
            </button>
          </div>

          {topSpacer > 0 ? <div aria-hidden style={{ height: topSpacer }} /> : null}

          {renderRows.map((rowIndex) => {
            const rowHasVerticalMerge =
              !filtering &&
              merges.some((merge) => merge.startRow === rowIndex && merge.rowSpan > 1);
            const frozen = rowIndex < frozenRows;
            return (
            <div
              key={rows[rowIndex].id}
              className={`${frozen ? "" : "relative"} grid overflow-visible`}
              style={{
                gridTemplateColumns,
                zIndex: frozen ? 15 : rowHasVerticalMerge ? 8 : undefined,
                ...(frozen ? { position: "sticky", top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT } : {}),
              }}
            >
              <div
                className={`sticky left-0 z-10 border-b border-r border-border px-2 text-center font-mono text-[11px] text-muted-foreground ${
                  rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow
                    ? "bg-[#2A2445] text-primary"
                    : "bg-muted"
                } ${
                  formulaRanges.some((picked) => rangeTouchesRow(picked, rowIndex))
                    ? "outline outline-dashed outline-primary/70"
                    : ""
                } ${rowIndex === frozenRows - 1 ? "border-b-2 border-b-[#7C66DC]/60" : ""}`}
                style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  gridRef.current?.focus();
                  if (isEditingFormula) {
                    beginFormulaPick({ col: 0, row: rowIndex }, "formula-row");
                    return;
                  }
                  if (event.button !== 0) return;
                  const lastCol = columns.length - 1;
                  if (event.shiftKey) {
                    setRange((previous) => ({ anchor: { col: 0, row: previous.anchor.row }, focus: { col: lastCol, row: rowIndex } }));
                  } else {
                    setRange({ anchor: { col: 0, row: rowIndex }, focus: { col: lastCol, row: rowIndex } });
                  }
                }}
                onMouseEnter={() => {
                  if (dragRef.current === "formula-row") {
                    extendFormulaPick({ col: 0, row: rowIndex });
                  }
                }}
                onContextMenu={(event) => {
                  if (rowIndex < bounds.minRow || rowIndex > bounds.maxRow) {
                    setSelection({ col: selected.col, row: rowIndex });
                  }
                  showContextMenu(event, rowMenu(rowIndex), {
                    title: `Row ${rowIndex + 1}`,
                  });
                }}
              >
                {rowIndex + 1}
              </div>

              {visibleCols.map((colIndex) => {
                const column = columns[colIndex];
                const address = { col: colIndex, row: rowIndex };
                const frozenLeft = stickyLeft.get(colIndex);
                const stickyStyle =
                  frozenLeft !== undefined ? { position: "sticky" as const, left: frozenLeft, zIndex: 6 } : undefined;
                if (coveredByMerge(merges, address)) {
                  const covered = findMerge(merges, address);
                  const ignoreVerticalCover = Boolean(
                    filtering && covered && covered.rowSpan > 1,
                  );
                  if (ignoreVerticalCover && covered && address.row === covered.startRow && address.col !== covered.startCol) {
                    return null;
                  }
                  if (!ignoreVerticalCover) {
                    if (covered && address.col === covered.startCol) {
                      return (
                        <div
                          key={column.id}
                          className="h-8 min-w-0"
                          style={{
                            gridColumn: `span ${visibleSpan(covered.startCol, covered.colSpan)}`,
                            height: ROW_HEIGHT,
                          }}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            window.getSelection()?.removeAllRanges();
                            gridRef.current?.focus();
                            if (isEditingFormula) {
                              beginFormulaPick(
                                { col: covered.startCol, row: covered.startRow },
                                "formula",
                              );
                              return;
                            }
                            if (event.shiftKey) setSelection(address, true);
                            else setSelection(rangeFromMerge(covered));
                            dragRef.current = "select";
                          }}
                          onMouseEnter={() => {
                            if (dragRef.current?.startsWith("formula")) {
                              extendFormulaPick(address);
                              return;
                            }
                            if (dragRef.current === "select") setSelection(address, true);
                          }}
                        />
                      );
                    }
                    // A merge that starts in a hidden column still needs its space.
                    if (covered && columns[covered.startCol]?.hidden && visibleCols.find((c) => c >= covered.startCol) === colIndex) {
                      return (
                        <div
                          key={column.id}
                          style={{ gridColumn: `span ${visibleSpan(covered.startCol, covered.colSpan)}`, height: ROW_HEIGHT }}
                        />
                      );
                    }
                    return null;
                  }
                }

                const merge = findMerge(merges, address);
                const isVerticalOrigin = Boolean(
                  !filtering && merge && isMergeOrigin(merge, address) && merge.rowSpan > 1,
                );
                const mergeRowSpan =
                  !filtering && merge && isMergeOrigin(merge, address) ? merge.rowSpan : 1;
                const isSelected = sameAddress(selected, address);
                const inRange = isInRange(address, range);
                const isEditing = editing?.col === colIndex && editing?.row === rowIndex;
                const result = evaluator.valueAt(colIndex, rowIndex);
                const raw = rawAt(address);
                const ownFormat = formatAt(rows[rowIndex], column.id);
                const rule = conditional.get(`${colIndex}:${rowIndex}`);
                const format = rule ? { ...ownFormat, ...rule } : ownFormat;
                const display = formatSheetCell(result, column, raw, ownFormat);
                const chip = column.type === "text" || column.type === "formula" ? statusChip(display) : null;
                const align = format?.align ?? defaultAlign(column.type);
                const inFormulaRange = isInAnyRange(address, formulaRanges);
                const misfit = !cellFitsType(column.type, raw);
                const isFillCorner =
                  !isEditingFormula &&
                  ((merge &&
                    isMergeOrigin(merge, address) &&
                    isExactMergeSelection(range, merge)) ||
                    (colIndex === bounds.maxCol &&
                      rowIndex === bounds.maxRow &&
                      !isVerticalOrigin));
                const verticalAlign: SheetVerticalAlign = format?.verticalAlign ?? "middle";
                const showDatePicker =
                  isSelected && !isEditing && column.type === "date" && !isFormulaValue(raw);

                return (
                  <div
                    key={column.id}
                    className="relative min-w-0"
                    style={{
                      gridColumn:
                        merge && isMergeOrigin(merge, address) && merge.colSpan > 1
                          ? `span ${visibleSpan(merge.startCol, merge.colSpan)}`
                          : undefined,
                      height:
                        format?.wrap && mergeRowSpan === 1 ? "auto" : ROW_HEIGHT,
                      minHeight: ROW_HEIGHT,
                      ...stickyStyle,
                    }}
                  >
                  <div
                    data-cell={`${colIndex}-${rowIndex}`}
                    onMouseDown={(event) => {
                      // Right-click (or middle-click) never starts a drag. Inside
                      // the selection it keeps the range so the context menu acts
                      // on all of it; outside it moves the selection to this cell.
                      if (event.button !== 0) {
                        if (isEditing) return;
                        event.preventDefault();
                        window.getSelection()?.removeAllRanges();
                        gridRef.current?.focus();
                        if (event.button !== 2 || inRange) return;
                        const mergeAt = findMerge(merges, address);
                        setSelection(mergeAt ? rangeFromMerge(mergeAt) : address);
                        return;
                      }
                      if (isEditingFormula && !isEditing) {
                        event.preventDefault();
                        beginFormulaPick(address, "formula");
                        return;
                      }
                      if (isEditing) return;
                      if ((event.target as HTMLElement).closest("[data-cell-picker]")) return;
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
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest("[data-cell-picker]")) return;
                      startEditing(address);
                    }}
                    onContextMenu={(event) => {
                      if (!inRange) setSelection(address);
                      showContextMenu(event, cellMenu(address), {
                        title: rangeAddressLabel(inRange ? range : { anchor: address, focus: address }),
                      });
                    }}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("[data-cell-picker]")) return;
                      if (!isSelected || isFormulaValue(raw)) return;
                      if (column.type === "boolean") toggleBoolean(address);
                      if (column.type === "select") openSelectMenu(address);
                    }}
                    title={misfit ? `This doesn't look like a ${column.type === "boolean" ? "checkbox value" : column.type}. It is kept as typed.` : format?.note}
                    className={`flex min-w-0 border-b border-r border-border px-2 text-sm ${
                      isVerticalOrigin ? "absolute inset-x-0 top-0 z-[8]" : "relative h-full"
                    } ${
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
                    } ${format?.clip && !isVerticalOrigin ? "overflow-hidden" : ""} ${
                      (merge && isMergeOrigin(merge, address)) || frozen || frozenLeft !== undefined ? (isSelected ? "" : "bg-background") : ""
                    } ${colIndex === lastFrozenCol ? "border-r-2 border-r-[#7C66DC]/60" : ""} ${
                      rowIndex === frozenRows - 1 ? "border-b-2 border-b-[#7C66DC]/60" : ""
                    }`}
                    style={{
                      height:
                        format?.wrap && mergeRowSpan === 1
                          ? "auto"
                          : ROW_HEIGHT * mergeRowSpan,
                      minHeight: ROW_HEIGHT * mergeRowSpan,
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
                          setFormulaRanges([]);
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
                          if (handleHintKey(event)) return;
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
                    ) : column.type === "select" && !isFormulaValue(raw) && display ? (
                      <span
                        title="Click to choose"
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                      >
                        <span className="truncate">{display}</span>
                        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                      </span>
                    ) : column.type === "select" && !isFormulaValue(raw) && isSelected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                        Choose
                        <ChevronDown className="size-3" />
                      </span>
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
                    {showDatePicker ? (
                      <span data-cell-picker className="absolute right-1 top-1/2 z-20 -translate-y-1/2">
                        <DatePicker
                          iconOnly
                          value={/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : ""}
                          onChange={(value) => {
                            setCellValue(address, value);
                            gridRef.current?.focus();
                          }}
                          aria-label="Pick a date"
                          className="size-6 bg-[#251F3E]"
                        />
                      </span>
                    ) : null}
                    {misfit ? (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-0 size-0 border-b-[6px] border-r-[6px] border-b-warning border-r-transparent"
                      />
                    ) : null}
                    {format?.note ? (
                      <span
                        title={format.note}
                        className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-warning"
                      />
                    ) : null}
                    {isFillCorner && !isEditing ? (
                      <span
                        title="Drag to fill"
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
                  </div>
                );
              })}

              <div className={`border-b border-border ${frozen ? "bg-background" : ""}`} />
            </div>
            );
          })}

          {bottomSpacer > 0 ? <div aria-hidden style={{ height: bottomSpacer }} /> : null}

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

      {fitHint && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-t border-amber-500/30 bg-amber-500/5 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-300"
        >
          <button
            type="button"
            title="Go to cell"
            onClick={() => setSelection({ col: fitCol, row: fitRow })}
            className="font-mono font-semibold hover:underline"
          >
            {fitHint.address}
          </button>
          <span className="min-w-0 flex-1 truncate">{fitHint.hint}</span>
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss hint"
            onClick={() => {
              if (fitHint.logId) fitFeedback.mutate({ logId: fitHint.logId, accepted: false });
              setDismissedFit(fitHint.id);
            }}
            className="rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        </div>
      )}

      <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-[#191B22] px-3 text-[11px]">
        <div className="flex min-w-0 items-end gap-1">
          {(tabs?.length ?? 0) > 1 ? (
            <button
              type="button"
              title="All tabs"
              aria-label="All tabs"
              onClick={(event) =>
                showContextMenu(
                  event,
                  (tabs ?? []).map((tab) => ({
                    kind: "action" as const,
                    label: tab.name,
                    checked: tab.id === activeTabId,
                    onSelect: () => onSelectTab?.(tab.id),
                  })),
                  { title: "Tabs" },
                )
              }
              className="mb-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ListIcon className="size-3.5" />
            </button>
          ) : null}
          <div
            ref={tabStripRef}
            onWheel={(event) => {
              // A mouse wheel scrolls the tab strip sideways.
              if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
            }}
            className="flex min-w-0 items-end gap-1 overflow-x-auto pt-1 [scrollbar-width:none]"
          >
            {(tabs ?? []).map((tab, tabIndex) => {
              const active = tab.id === activeTabId;
              const openTabMenu = (event: ReactMouseEvent) => {
                event.preventDefault();
                showContextMenu(
                  event,
                  tidyEntries([
                    { kind: "action", label: "Rename", icon: Pencil, onSelect: () => setRenamingTabId(tab.id) },
                    onDuplicateTab && { kind: "action" as const, label: "Duplicate", icon: Copy, onSelect: () => onDuplicateTab(tab.id) },
                    onColorTab && {
                      kind: "submenu" as const,
                      label: "Colour",
                      icon: Palette,
                      items: [
                        { kind: "action" as const, label: "None", checked: !tab.color, onSelect: () => onColorTab(tab.id, undefined) },
                        ...TAB_COLORS.map((choice) => ({
                          kind: "action" as const,
                          label: choice.label,
                          checked: tab.color?.toUpperCase() === choice.value,
                          onSelect: () => onColorTab(tab.id, choice.value),
                        })),
                      ],
                    },
                    { kind: "separator" },
                    onMoveTab && {
                      kind: "action" as const,
                      label: "Move left",
                      icon: ArrowLeft,
                      disabled: tabIndex === 0,
                      onSelect: () => onMoveTab(tab.id, -1),
                    },
                    onMoveTab && {
                      kind: "action" as const,
                      label: "Move right",
                      icon: ArrowRight,
                      disabled: tabIndex === (tabs?.length ?? 1) - 1,
                      onSelect: () => onMoveTab(tab.id, 1),
                    },
                    { kind: "separator" },
                    onDeleteTab && {
                      kind: "action" as const,
                      label: "Delete tab",
                      icon: Trash2,
                      danger: true,
                      disabled: (tabs?.length ?? 0) <= 1,
                      onSelect: () => onDeleteTab(tab.id),
                    },
                  ]),
                  { title: tab.name },
                );
              };
              return (
                <div
                  key={tab.id}
                  data-active-tab={active ? "" : undefined}
                  onContextMenu={openTabMenu}
                  className={`relative flex shrink-0 items-center gap-1 rounded-t border border-b-0 px-2 py-1 ${
                    active
                      ? "border-[#7C66DC] bg-[#1F222B] text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/60"
                  }`}
                >
                  {tab.color ? (
                    <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full" style={{ background: tab.color }} />
                  ) : null}
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
                      title={`${tab.name} · right-click for more`}
                      className="max-w-28 truncate"
                    >
                      {tab.name}
                    </button>
                  )}
                  {active ? (
                    <button
                      type="button"
                      title="Tab options"
                      aria-label="Tab options"
                      onClick={openTabMenu}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {onAddTab && (
            <button
              type="button"
              title="New Tab"
              onClick={onAddTab}
              className="mb-0.5 flex shrink-0 size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
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

const POPOVER_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * Column-header menus render into `document.body` so the grid's scroll
 * container cannot clip them. The panel hangs below its column header,
 * lined up with the column's left edge, and is clamped to stay inside
 * `boundsRef` and the viewport.
 *
 * The header is found from a marker rendered in place. A ref on the header
 * would be attached only after this effect runs on the first open, which in
 * a production build left the panel at the window's top-left corner.
 */
function AnchoredPopover({
  boundsRef,
  className,
  children,
}: {
  boundsRef: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = markerRef.current?.closest<HTMLElement>("[data-column-header]");
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const anchorRect = anchor.getBoundingClientRect();
      const bounds = boundsRef.current?.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const minLeft = Math.max(VIEWPORT_MARGIN, bounds ? bounds.left + POPOVER_GAP : 0);
      const maxLeft = Math.min(
        window.innerWidth - VIEWPORT_MARGIN,
        bounds ? bounds.right - POPOVER_GAP : Infinity,
      ) - width;
      const left = Math.max(minLeft, Math.min(anchorRect.left, maxLeft));
      const below = anchorRect.bottom + POPOVER_GAP;
      const top =
        below + height > window.innerHeight - VIEWPORT_MARGIN
          ? Math.max(VIEWPORT_MARGIN, anchorRect.top - height - POPOVER_GAP)
          : below;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [boundsRef]);

  return (
    <>
      <span ref={markerRef} hidden />
      {createPortal(
        <div
          ref={panelRef}
          data-sheet-popover
          className={`invisible fixed left-0 top-0 z-[100] ${className ?? ""}`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

function formatStat(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}
