import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import {
  Dimensions,
  PanResponder,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Combine,
  DollarSign,
  Eraser,
  Filter,
  Hash,
  Italic,
  Minus,
  PaintBucket,
  Percent,
  Plus,
  Redo2,
  Sigma,
  Snowflake,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Ungroup,
  WrapText,
} from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { columnIndexToLetter, createSheetEvaluator, shiftFormula } from "@timely/contract/sheetFormula";
import { closeOpenParens, formulaAcceptsAnotherRange, insertFormulaRange, type FormulaRefSpan } from "@timely/contract/sheetFormulaInput";
import {
  type CellAddress,
  type CellRange,
  activeCellInRange,
  clampAddress,
  findMerge,
  formulaOutputAddress,
  guessAggregateRange,
  hasMergeInRange,
  isExactMergeSelection,
  isInAnyRange,
  isInRange,
  mergeAll,
  normalizedRange,
  rangeAddressLabel,
  rangeFromMerge,
  rangeTouchesCol,
  rangeTouchesRow,
  sameAddress,
  sameRange,
  selectionAddressLabel,
  unmergeRange,
  visitRange,
} from "@timely/contract/sheetRange";
import { cellFitsType, editTextForCell, isFormulaValue, normalizeTypedCell, typedEntryForColumn } from "@timely/contract/sheetCell";
import { conditionalStyles, formatSheetCell, type ConditionalStyle } from "@timely/contract/sheetDisplay";
import { conditionalSummaryRows } from "@timely/contract/sheetOps";
import {
  SHEET_COLUMN_TYPES,
  columnTypeBadge,
  emptySheetRow,
  newSheetId,
  parseSelectOptions,
  syncSelectOptions,
} from "../../lib/sheet";
import { growGridTo, isPastGrid } from "../../lib/sheetGrow";
import { cellFitEdit } from "../../lib/sheetCellFit";
import { indexAtScreen, pinnedColumnWidths, pinnedRowCount, screenStart, type PinnedAxis } from "../../lib/sheetFreeze";
import { useCellFit, useDecisionFeedback, type CellFitEdit } from "../../lib/hooks";
import type { SheetCellFormat, SheetColumn, SheetColumnType, SheetConditionalFormat, SheetMerge, SheetRow, SheetTab } from "../../lib/types";

const MIN_WIDTH = 82;
const MAX_WIDTH = 240;
const ROW_HEAD = 38;
const CELL_H = 32;
const HEADER_H = 34;
const GHOST_COL_W = 104;
// Pinned columns (row numbers included) and pinned rows (header included)
// leave the rest of a phone screen free to scroll.
const PIN_WIDTH_SHARE = 0.6;
const PIN_HEIGHT_SHARE = 0.5;
const FILL_SWATCHES = ["#3A3558", "#8B7CF7", "#3E63DD", "#12A594", "#E8B54A", "#EF6B5C", "#E93D82"];
const KINETIC = {
  base: "#111319",
  surface: "#191B22",
  card: "#1F222B",
  border: "#282C37",
  divider: "#2B2F3D",
  accent: "#6E56CF",
  accentHover: "#7C66DC",
  text: "#F1F3F9",
  secondary: "#949AA8",
  muted: "#5E6573",
};

type DrawerTab = "format" | "numbers" | "insert" | "functions";
type DragMode = "select" | "fill" | "formula" | "formula-col" | "formula-row";
type Address = CellAddress;
type GridSnapshot = { columns: SheetColumn[]; rows: SheetRow[]; merges: SheetMerge[]; frozenRows: number; frozenCols: number };
type GridChange = { columns?: SheetColumn[]; rows?: SheetRow[]; merges?: SheetMerge[]; frozenRows?: number; frozenCols?: number };
type HitZone = { zone: "cell" | "col" | "row"; col: number; row: number };
type FormulaInsert = { label: string; template: (range: string) => string };

const FORMULA_GROUPS: { title: string; items: FormulaInsert[] }[] = [
  {
    title: "MATH",
    items: [
      { label: "SUM", template: (range) => `=SUM(${range})` },
      { label: "AVERAGE", template: (range) => `=AVERAGE(${range})` },
      { label: "MIN", template: (range) => `=MIN(${range})` },
      { label: "MAX", template: (range) => `=MAX(${range})` },
      { label: "PRODUCT", template: (range) => `=PRODUCT(${range})` },
      { label: "COUNT", template: (range) => `=COUNT(${range})` },
      { label: "COUNTA", template: (range) => `=COUNTA(${range})` },
    ],
  },
  {
    title: "NUMBER",
    items: [
      { label: "ABS", template: (range) => `=ABS(${range || "A1"})` },
      { label: "SQRT", template: (range) => `=SQRT(${range || "A1"})` },
      { label: "ROUND", template: (range) => `=ROUND(${range || "A1"},0)` },
      { label: "FLOOR", template: (range) => `=FLOOR(${range || "A1"})` },
      { label: "CEILING", template: (range) => `=CEILING(${range || "A1"})` },
      { label: "POWER", template: (range) => `=POWER(${range || "A1"},2)` },
    ],
  },
  {
    title: "LOGIC",
    items: [
      { label: "IF", template: (range) => `=IF(${range || "A1"}>0,"yes","no")` },
      { label: "AND", template: (range) => `=AND(${range})` },
      { label: "OR", template: (range) => `=OR(${range})` },
      { label: "NOT", template: (range) => `=NOT(${range || "A1"})` },
    ],
  },
  {
    title: "TEXT",
    items: [
      { label: "CONCAT", template: (range) => `=CONCAT(${range || "A1"},"")` },
      { label: "LEN", template: (range) => `=LEN(${range || "A1"})` },
      { label: "UPPER", template: (range) => `=UPPER(${range || "A1"})` },
      { label: "LOWER", template: (range) => `=LOWER(${range || "A1"})` },
      { label: "TRIM", template: (range) => `=TRIM(${range || "A1"})` },
    ],
  },
];

export type SheetGridProps = {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
  /** Every tab of the workbook, so formulas like =SUM(January!H2:H) work. */
  workbook?: { tabs: SheetTab[]; currentTabId?: string };
  /** The tab's conditional formats, tested below its frozen rows. */
  conditionalFormats?: SheetConditionalFormat[];
  /** Rows and columns that stay in view while the rest of the tab scrolls. */
  frozenRows?: number;
  frozenCols?: number;
  onAssistantContext?: (value: { selection: string; filter: string; draft: string }) => void;
  onChange: (next: GridChange) => void;
};

/** Lets the owning screen finish an in-progress cell edit before it leaves. */
export type SheetGridHandle = {
  /** Commits the active cell draft, if any. Returns whether a draft was committed. */
  commitActiveEdit: () => boolean;
};

export default function SheetGrid({
  columns,
  rows,
  merges = [],
  workbook,
  conditionalFormats,
  frozenRows = 0,
  frozenCols = 0,
  onChange,
  onAssistantContext,
  ref,
}: SheetGridProps & { ref?: Ref<SheetGridHandle> }) {
  const [range, setRange] = useState<CellRange>({
    anchor: { col: 0, row: 0 },
    focus: { col: 0, row: 0 },
  });
  const [editing, setEditing] = useState<Address | null>(null);
  const [editSource, setEditSource] = useState<"formula" | "cell" | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [columnMenu, setColumnMenu] = useState<number | null>(null);
  const [typeMenu, setTypeMenu] = useState<number | null>(null);
  const [selectMenu, setSelectMenu] = useState<Address | null>(null);
  const [optionsEditor, setOptionsEditor] = useState<number | null>(null);
  const [optionsDraft, setOptionsDraft] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [past, setPast] = useState<GridSnapshot[]>([]);
  const [future, setFuture] = useState<GridSnapshot[]>([]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("format");
  const [formulaRanges, setFormulaRanges] = useState<CellRange[]>([]);
  const [gridLocked, setGridLocked] = useState(false);
  const [fitEdit, setFitEdit] = useState<CellFitEdit | null>(null);
  const [dismissedFit, setDismissedFit] = useState(0);
  const cellFit = useCellFit(fitEdit);
  const fitFeedback = useDecisionFeedback();

  // The grid's scroll offsets, tracked on the UI thread. Pinned layers slide
  // by the same amount in the same frame, so they never trail the grid.
  const scrollX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const onScrollX = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  const onScrollY = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const pinX = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, scrollX.value) }] }));
  const pinY = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, scrollY.value) }] }));
  const pinXY = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.max(0, scrollX.value) }, { translateY: Math.max(0, scrollY.value) }],
  }));

  const selected = activeCellInRange(range, merges);
  const bounds = normalizedRange(range);
  const dragModeRef = useRef<DragMode | null>(null);
  const fillOriginRef = useRef<CellRange | null>(null);
  const formulaPickOriginRef = useRef<Address | null>(null);
  const formulaSpanRef = useRef<FormulaRefSpan | null>(null);
  const formulaPickingRef = useRef(false);
  const caretRef = useRef(0);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  const rangeRef = useRef(range);
  const gridViewportRef = useRef<View>(null);
  const formulaInputRef = useRef<TextInput>(null);
  const cellInputRef = useRef<TextInput>(null);
  const optionsInputRef = useRef<TextInput>(null);
  const touchStartRef = useRef<{ pageX: number; pageY: number } | null>(null);
  const gridLockedRef = useRef(false);
  const skipTapRef = useRef(false);
  const pressWasSelectedRef = useRef(false);
  const editingFormulaRef = useRef(false);
  const selectKindRef = useRef<"cell" | "col" | "row" | null>(null);
  const dragOriginRef = useRef<{
    hit: HitZone;
    pageX: number;
    pageY: number;
    locationX: number;
    locationY: number;
  } | null>(null);

  draftRef.current = draft;
  editingRef.current = editing;
  rangeRef.current = range;
  editingFormulaRef.current = Boolean(editing && isFormulaValue(draft));

  useImperativeHandle(ref, () => ({
    commitActiveEdit: () => {
      if (!editingRef.current) return false;
      // A half-picked formula range is still worth keeping over losing the cell.
      formulaPickingRef.current = false;
      commitEdit();
      return true;
    },
  }));

  function onGridLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width === viewport.width && next.height === viewport.height) return;
    if (next.width > 0 && next.height > 0) setViewport(next);
  }

  function setSelection(
    next: CellAddress | CellRange,
    extend = false,
    grown?: { cols?: number; rows?: number },
  ) {
    // Blank cells past the end are selectable without becoming real rows, so
    // clamp to what the grid draws rather than to the data.
    const colCount = Math.max(columns.length + ghostColCount, grown?.cols ?? 0, 1);
    const rowCount = Math.max(rows.length + ghostRowCount, grown?.rows ?? 0, 1);
    if ("anchor" in next) {
      setRange({
        anchor: clampAddress(next.anchor, colCount, rowCount),
        focus: clampAddress(next.focus, colCount, rowCount),
      });
      return;
    }
    const focus = clampAddress(next, colCount, rowCount);
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
  }

  function lockGrid(lock: boolean) {
    gridLockedRef.current = lock;
    setGridLocked(lock);
  }

  function localInBox(value: number, size: number) {
    const ratio = PixelRatio.get();
    const scaled = ratio > 1 && value > size + 8 ? value / ratio : value;
    return Math.min(Math.max(0, scaled), Math.max(size - 0.01, 0));
  }

  function noteTouch(
    hit: HitZone,
    pageX: number,
    pageY: number,
    locationX = 0,
    locationY = 0,
  ) {
    const colW = columns[hit.col] ? colWidth(columns[hit.col]) : GHOST_COL_W;
    const cellH = hit.zone === "col" ? HEADER_H : CELL_H;
    dragOriginRef.current = {
      hit,
      pageX,
      pageY,
      locationX: localInBox(locationX, colW),
      locationY: localInBox(locationY, cellH),
    };
    touchStartRef.current = { pageX, pageY };
  }

  function dragScale(ax: number, ay: number, bx: number, by: number) {
    const ratio = PixelRatio.get();
    const { width, height } = Dimensions.get("window");
    const physical = [ax, bx].some((value) => value > width + 8) || [ay, by].some((value) => value > height + 8);
    return physical && ratio > 1 ? ratio : 1;
  }

  // Drags are measured from where the touch started, on screen. Pinned rows
  // and columns don't move with the scroll, so a drag from a pinned cell into
  // the scrolled part has to add the scroll offset back in.
  function pinnedAxes(): { x: PinnedAxis; y: PinnedAxis } {
    return {
      x: {
        lead: ROW_HEAD,
        sizeAt: (index) => (columns[index] ? colWidth(columns[index]) : GHOST_COL_W),
        pinned: pinCols,
        scroll: Math.max(0, scrollX.value),
      },
      y: { lead: HEADER_H, sizeAt: () => CELL_H, pinned: pinRows, scroll: Math.max(0, scrollY.value) },
    };
  }

  function addressFromPage(pageX: number, pageY: number): HitZone | null {
    const origin = dragOriginRef.current;
    if (!origin) return null;
    const scale = dragScale(origin.pageX, origin.pageY, pageX, pageY);
    const dx = (pageX - origin.pageX) / scale;
    const dy = (pageY - origin.pageY) / scale;
    const axes = pinnedAxes();
    const x = screenStart(axes.x, origin.hit.col) + origin.locationX + dx;
    const col = indexAtScreen(axes.x, x, Math.max(columns.length, 1));
    if (origin.hit.zone === "col") {
      const row = Math.max(0, origin.hit.row + Math.floor((origin.locationY + dy) / HEADER_H));
      return { zone: origin.hit.zone, col, row };
    }
    const y = screenStart(axes.y, origin.hit.row) + origin.locationY + dy;
    const row = indexAtScreen(axes.y, y, rows.length + ghostRowCount);
    return { zone: origin.hit.zone, col, row };
  }

  function onCellPressIn(col: number, row: number, event: GestureResponderEvent) {
    const { pageX, pageY, locationX, locationY } = event.nativeEvent;
    noteTouch({ zone: "cell", col, row }, pageX, pageY, locationX, locationY);
    const current = rangeRef.current;
    const mergeAt = findMerge(merges, { col, row });
    pressWasSelectedRef.current = mergeAt
      ? sameRange(current, rangeFromMerge(mergeAt))
      : current.anchor.col === col
        && current.anchor.row === row
        && current.focus.col === col
        && current.focus.row === row;
    if (isEditingFormula()) {
      beginFormulaFromHit({ zone: "cell", col, row });
      return;
    }
    if (pressWasSelectedRef.current) return;
    if (col >= columns.length || row >= rows.length) {
      selectGrown({ col, row });
      return;
    }
    if (mergeAt) setSelection(rangeFromMerge(mergeAt));
    else setSelection({ col, row });
  }

  function onCellLongPress(col: number, row: number) {
    if (isEditingFormula()) {
      beginFormulaFromHit({ zone: "cell", col, row });
      return;
    }
    beginSelectFromHit({ zone: "cell", col, row });
  }

  function clearFormulaPick() {
    formulaPickingRef.current = false;
    formulaPickOriginRef.current = null;
    formulaSpanRef.current = null;
    setFormulaRanges([]);
  }

  function isEditingFormula() {
    return Boolean(editingRef.current && isFormulaValue(draftRef.current));
  }

  const workbookTabs = workbook?.tabs;
  const currentTabId = workbook?.currentTabId;
  const evaluator = useMemo(() => {
    if (!workbookTabs?.length) return createSheetEvaluator(columns, rows);
    // The grid's own columns/rows are the freshest copy of the current tab.
    const tabs = workbookTabs.map((tab) => (tab.id === currentTabId ? { ...tab, columns, rows } : tab));
    return createSheetEvaluator(columns, rows, { tabs, currentTabId });
  }, [columns, rows, workbookTabs, currentTabId]);
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
    [conditionalFormats, columns, rows, evaluator, frozenRows],
  );
  const hiddenCount = columns.filter((column) => column.hidden).length;
  const showFilter = filterOpen || filterQuery.length > 0;
  const visibleRowIndexes = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return rows.map((_, index) => index);
    return rows.flatMap((row, index) => {
      const haystack = columns
        .map((column, colIndex) => `${column.name} ${row.cells?.[column.id] ?? ""} ${evaluator.displayAt(colIndex, index)}`)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query) ? [index] : [];
    });
  }, [columns, evaluator, filterQuery, rows]);

  // Frozen columns stay at the left while the rest scroll. A narrow screen
  // draws them narrower, or pins fewer, so the rest of the tab still shows.
  const pinnedWidthById = useMemo(() => {
    if (viewport.width <= 0) return new Map<string, number>();
    const widths = pinnedColumnWidths(
      columns.map(naturalColWidth),
      frozenCols,
      viewport.width * PIN_WIDTH_SHARE - ROW_HEAD,
      MIN_WIDTH,
    );
    return new Map(widths.map((width, index) => [columns[index].id, width]));
  }, [columns, frozenCols, viewport.width]);
  const pinCols = pinnedWidthById.size;
  const pinRows = pinnedRowCount(frozenRows, rows.length, viewport.height, HEADER_H, CELL_H, PIN_HEIGHT_SHARE);
  const colWidth = (column: SheetColumn) => pinnedWidthById.get(column.id) ?? naturalColWidth(column);

  const filtering = filterQuery.trim().length > 0;
  const ghostColCount = Math.max(
    1,
    Math.ceil(Math.max(viewport.width - ROW_HEAD, GHOST_COL_W) / GHOST_COL_W) - columns.length,
  );
  const neededRows = Math.max(
    visibleRowIndexes.length + 1,
    Math.ceil(Math.max(viewport.height - HEADER_H, CELL_H) / CELL_H),
  );
  const ghostRowCount = filtering ? 0 : Math.max(1, neededRows - visibleRowIndexes.length);

  const snapshot = (): GridSnapshot => ({ columns, rows, merges, frozenRows, frozenCols });

  function commit(next: GridChange) {
    setPast((prev) => [...prev.slice(-29), snapshot()]);
    setFuture([]);
    if (next.rows) {
      // Dropdown columns learn new values as they are typed or pasted.
      const synced = syncSelectOptions(next.columns ?? columns, next.rows);
      if (synced.columns !== (next.columns ?? columns) || synced.rows !== next.rows) {
        onChange({ ...next, columns: synced.columns, rows: synced.rows });
        return;
      }
    }
    onChange(next);
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [snapshot(), ...prev]);
    onChange(previous);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev, snapshot()]);
    onChange(next);
  }

  const rawAt = (address: Address) => {
    const column = columns[address.col];
    const row = rows[address.row];
    if (!column || !row) return "";
    const value = row.cells?.[column.id];
    return value == null ? "" : String(value);
  };

  /** Writes one cell, growing the grid when it is past the end. Returns the
   * grid as it was just before the value went in (grown to reach the cell),
   * or null when nothing was written. */
  function setCellValue(address: Address, value: string): { columns: SheetColumn[]; rows: SheetRow[] } | null {
    const grid = { columns, rows };
    // Leaving a blank cell past the end blank is not an edit.
    if (isPastGrid(grid, address) && value.trim() === "") return null;
    const grown = growGridTo(grid, address, makeColumn, emptySheetRow);
    const column = grown.columns[address.col];
    if (!column) return null;
    commit({
      columns: grown.columns !== columns ? grown.columns : undefined,
      rows: grown.rows.map((row, index) =>
        index === address.row
          ? {
              ...row,
              cells: {
                ...row.cells,
                [column.id]: isFormulaValue(value) ? value : normalizeTypedCell(column.type, value),
              },
            }
          : row,
      ),
    });
    return grown;
  }

  /** Empties every cell in the current selection, not just the active one. */
  function clearSelection() {
    const nextRows = rows.map((row) => ({ ...row, cells: { ...row.cells } }));
    visitRange(range, (address) => {
      const column = columns[address.col];
      const row = nextRows[address.row];
      if (!column || !row) return;
      row.cells[column.id] = "";
    });
    commit({ rows: nextRows });
  }

  function makeColumn(index: number): SheetColumn {
    return {
      id: newSheetId("col"),
      name: columnIndexToLetter(index),
      width: 140,
      type: "text",
    };
  }

  function addColumn(at = columns.length) {
    const atIndex = Math.min(at, columns.length);
    const column = makeColumn(atIndex);
    const nextColumns = [...columns];
    nextColumns.splice(atIndex, 0, column);
    commit({
      columns: nextColumns,
      rows: rows.map((row) => ({ ...row, cells: { ...row.cells, [column.id]: "" } })),
      // A column added inside the frozen ones is frozen too, as on desktop.
      frozenCols: atIndex < frozenCols ? frozenCols + 1 : undefined,
    });
  }

  function deleteColumn(index: number) {
    if (columns.length <= 1) return;
    const removed = columns[index];
    if (!removed) return;
    commit({
      frozenCols: index < frozenCols ? frozenCols - 1 : undefined,
      columns: columns.filter((_, i) => i !== index),
      rows: rows.map((row) => {
        const cells = { ...row.cells };
        delete cells[removed.id];
        return { ...row, cells };
      }),
    });
    setSelection({
      col: Math.max(0, Math.min(selected.col, columns.length - 2)),
      row: selected.row,
    });
  }

  function addRow(atIndex = rows.length) {
    const next = [...rows];
    next.splice(atIndex, 0, emptySheetRow(columns));
    commit({ rows: next, frozenRows: atIndex < frozenRows ? frozenRows + 1 : undefined });
  }

  function deleteRow(index: number) {
    if (rows.length <= 1 || index >= rows.length) return;
    commit({ rows: rows.filter((_, i) => i !== index), frozenRows: index < frozenRows ? frozenRows - 1 : undefined });
    setSelection({
      col: selected.col,
      row: Math.max(0, Math.min(selected.row, rows.length - 2)),
    });
  }

  function materialize(address: Address) {
    const grown = growGridTo({ columns, rows }, address, makeColumn, emptySheetRow);
    if (grown.columns !== columns || grown.rows !== rows) {
      commit({
        columns: grown.columns !== columns ? grown.columns : undefined,
        rows: grown.rows !== rows ? grown.rows : undefined,
      });
    }
  }

  // Selecting past the end only moves the selection; the grid grows when a
  // value or format is written there (see growGridTo).
  function selectGrown(address: Address) {
    setSelection(address, false, { cols: address.col + 1, rows: address.row + 1 });
  }

  function renameColumn(index: number, name: string) {
    commit({
      columns: columns.map((column, i) =>
        i === index ? { ...column, name: name.trim() || columnIndexToLetter(i) } : column,
      ),
    });
  }

  function setColumnType(index: number, type: SheetColumnType) {
    const nextColumns = columns.map((column, i) => {
      if (i !== index) return column;
      const next: SheetColumn = { ...column, type };
      if (type !== "select") delete next.options;
      return next;
    });
    if (type === "select") {
      // Existing values become the first options so nothing is lost.
      const synced = syncSelectOptions(nextColumns, rows);
      commit({ columns: synced.columns, rows: synced.rows });
      return;
    }
    commit({ columns: nextColumns });
  }

  function setColumnHidden(index: number, hidden: boolean) {
    commit({
      columns: columns.map((column, i) => {
        if (i !== index) return column;
        const next: SheetColumn = { ...column };
        if (hidden) next.hidden = true;
        else delete next.hidden;
        return next;
      }),
    });
  }

  function showHiddenColumns() {
    commit({
      columns: columns.map((column) => {
        if (!column.hidden) return column;
        const next: SheetColumn = { ...column };
        delete next.hidden;
        return next;
      }),
    });
  }

  function setFrozen(patch: { frozenRows?: number; frozenCols?: number }) {
    commit(patch);
  }

  function openOptionsEditor(index: number) {
    setOptionsDraft((columns[index]?.options ?? []).join("\n"));
    setOptionsEditor(index);
  }

  function closeOptionsEditor() {
    optionsInputRef.current?.blur();
    setOptionsEditor(null);
  }

  function saveOptions() {
    const index = optionsEditor;
    if (index === null) return;
    const options = parseSelectOptions(optionsDraft);
    const nextColumns = columns.map((column, i) => (i === index ? { ...column, options } : column));
    const synced = syncSelectOptions(nextColumns, rows);
    commit({ columns: synced.columns, rows: synced.rows });
    closeOptionsEditor();
  }

  /** Second tap on a selected dropdown cell opens its choices instead of the text editor. */
  function tapSelectCell(address: Address) {
    if (skipTapRef.current || isEditingFormula() || !pressWasSelectedRef.current) {
      tapCell(address);
      return;
    }
    if (editing) commitEdit();
    setSelectMenu(address);
  }

  function sortColumn(index: number, direction: 1 | -1) {
    const column = columns[index];
    if (!column) return;
    const keyed = rows.map((row, rowIndex) => ({
      row,
      display: evaluator.displayAt(index, rowIndex),
    }));
    keyed.sort((a, b) => direction * a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: "base" }));
    commit({ rows: keyed.map((item) => item.row) });
  }

  function startEditing(address: Address, source: "formula" | "cell", initial?: string) {
    // The in-cell editor needs a real cell to render in; the formula bar
    // doesn't, and setCellValue grows the grid if a value is committed.
    if (source === "cell") materialize(address);
    setSelection(address, false, { cols: address.col + 1, rows: address.row + 1 });
    setDraft(initial ?? editTextForCell(columns[address.col]?.type, rawAt(address)));
    setEditing(address);
    setEditSource(source);
    formulaSpanRef.current = null;
    setFormulaRanges([]);
  }

  function commitEdit() {
    if (formulaPickingRef.current) return;
    const address = editingRef.current;
    if (!address) return;
    const raw = draftRef.current;
    // Typed entries read like a spreadsheet: "25" in a percent column is 25%.
    const value = isFormulaValue(raw) ? closeOpenParens(raw.trim()) : typedEntryForColumn(columns[address.col]?.type, raw);
    // Blur before the editor unmounts. Android otherwise hands focus to the
    // first TextInput on the screen (the sheet title) when a focused input
    // disappears, so the caret appeared in the title after tapping a cell.
    editingRef.current = null;
    if (cellInputRef.current?.isFocused()) cellInputRef.current.blur();
    const column = columns[address.col];
    // Retyping a cell that had a hint counts as the hint being useful.
    if (cellFit?.logId && cellFit.id !== dismissedFit && column?.id === cellFit.columnId && rows[address.row]?.id === cellFit.rowId && value.trim() !== cellFit.value) {
      fitFeedback.mutate({ logId: cellFit.logId, accepted: true });
      setDismissedFit(cellFit.id);
    }
    // Checked against the grid the value went into, so an entry in a row
    // added past the end (typed in the formula bar) is checked like any other.
    const written = setCellValue(address, value);
    const writtenColumn = written?.columns[address.col];
    const fit = written && writtenColumn ? cellFitEdit(writtenColumn, written.rows, address.row, normalizeTypedCell(writtenColumn.type, value)) : null;
    if (fit) setFitEdit(fit);
    setEditing(null);
    setEditSource(null);
    setDraft("");
    clearFormulaPick();
  }

  function focusFormulaBar(caret: number) {
    caretRef.current = caret;
    requestAnimationFrame(() => {
      formulaInputRef.current?.focus();
      formulaInputRef.current?.setNativeProps?.({ selection: { start: caret, end: caret } });
    });
  }

  function applyFormulaRange(
    picked: CellRange,
    mode: "replace" | "append" = "replace",
    focus = false,
  ) {
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
    if (focus) focusFormulaBar(result.caret);
  }

  function beginFormulaPick(address: Address, mode: "formula" | "formula-col" | "formula-row") {
    const shouldAppend = formulaAcceptsAnotherRange(draftRef.current, formulaSpanRef.current);
    formulaPickingRef.current = true;
    dragModeRef.current = mode;
    formulaPickOriginRef.current = address;
    const lastRow = Math.max(rows.length - 1, 0);
    const lastCol = Math.max(columns.length - 1, 0);
    const picked =
      mode === "formula-col"
        ? { anchor: { col: address.col, row: 0 }, focus: { col: address.col, row: lastRow } }
        : mode === "formula-row"
          ? { anchor: { col: 0, row: address.row }, focus: { col: lastCol, row: address.row } }
          : { anchor: address, focus: address };
    applyFormulaRange(picked, shouldAppend ? "append" : "replace", false);
  }

  function extendFormulaPick(address: Address) {
    const origin = formulaPickOriginRef.current;
    const mode = dragModeRef.current;
    if (!origin || !mode?.startsWith("formula")) return;
    const lastRow = Math.max(rows.length - 1, 0);
    const lastCol = Math.max(columns.length - 1, 0);
    if (mode === "formula-col") {
      applyFormulaRange({
        anchor: { col: origin.col, row: 0 },
        focus: { col: address.col, row: lastRow },
      });
      return;
    }
    if (mode === "formula-row") {
      applyFormulaRange({
        anchor: { col: 0, row: origin.row },
        focus: { col: lastCol, row: address.row },
      });
      return;
    }
    applyFormulaRange({ anchor: origin, focus: address });
  }

  function fillRange(from: CellRange, to: Address) {
    const nextColumns = columns.slice();
    const nextRows = rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
      formats: { ...(row.formats ?? {}) },
    }));
    if (to.col >= nextColumns.length) {
      for (let i = nextColumns.length; i <= to.col; i += 1) {
        const column = makeColumn(i);
        nextColumns.push(column);
        for (const row of nextRows) row.cells[column.id] = "";
      }
    }
    if (to.row >= nextRows.length) {
      while (nextRows.length <= to.row) nextRows.push({
        ...emptySheetRow(nextColumns),
        cells: { ...emptySheetRow(nextColumns).cells },
        formats: {},
      });
    }
    const source = normalizedRange(from);
    const target = {
      minCol: Math.min(source.minCol, to.col),
      maxCol: Math.max(source.maxCol, to.col),
      minRow: Math.min(source.minRow, to.row),
      maxRow: Math.max(source.maxRow, to.row),
    };
    const spanCol = source.maxCol - source.minCol + 1;
    const spanRow = source.maxRow - source.minRow + 1;

    for (let row = target.minRow; row <= target.maxRow; row += 1) {
      for (let col = target.minCol; col <= target.maxCol; col += 1) {
        if (col >= source.minCol && col <= source.maxCol && row >= source.minRow && row <= source.maxRow) {
          continue;
        }
        const srcCol = source.minCol + ((col - source.minCol) % spanCol + spanCol) % spanCol;
        const srcRow = source.minRow + ((row - source.minRow) % spanRow + spanRow) % spanRow;
        const sourceColumn = nextColumns[srcCol];
        const targetColumn = nextColumns[col];
        const sourceRow = nextRows[srcRow];
        const targetRow = nextRows[row];
        if (!sourceColumn || !targetColumn || !sourceRow || !targetRow) continue;
        const deltaCol = col - srcCol;
        const deltaRow = row - srcRow;
        let value = sourceRow.cells?.[sourceColumn.id] ?? "";
        if (isFormulaValue(value)) {
          value = shiftFormula(value, deltaCol, deltaRow);
        } else if (spanCol === 1 && spanRow === 1 && col === srcCol) {
          const numeric = Number(String(value).replace(/,/g, ""));
          if (value !== "" && Number.isFinite(numeric)) value = String(numeric + deltaRow);
        }
        targetRow.cells[targetColumn.id] = isFormulaValue(value)
          ? value
          : normalizeTypedCell(targetColumn.type, value);
        const sourceFormat = sourceRow.formats?.[sourceColumn.id];
        if (sourceFormat) targetRow.formats[targetColumn.id] = sourceFormat;
      }
    }

    commit({
      columns: nextColumns.length !== columns.length ? nextColumns : undefined,
      rows: nextRows.map((row) => ({
        ...row,
        formats: Object.keys(row.formats).length ? row.formats : undefined,
      })),
    });
    setSelection(
      {
        anchor: { col: target.minCol, row: target.minRow },
        focus: { col: target.maxCol, row: target.maxRow },
      },
      false,
      { cols: nextColumns.length, rows: nextRows.length },
    );
  }

  function tapCell(address: Address) {
    if (skipTapRef.current) {
      skipTapRef.current = false;
      if (dragModeRef.current?.startsWith("formula")) endDrag();
      return;
    }
    if (isEditingFormula()) {
      beginFormulaPick(address, "formula");
      return;
    }
    if (editing) commitEdit();
    if (address.col >= columns.length || address.row >= rows.length) {
      // Second tap on a blank cell past the end acts like it would on a real
      // cell of that column; setCellValue grows the grid once a value lands.
      const type = columns[address.col]?.type;
      if (!pressWasSelectedRef.current) selectGrown(address);
      else if (type === "boolean") {
        setCellValue(address, "TRUE");
        selectGrown(address);
      } else if (type === "select") setSelectMenu(address);
      else startEditing(address, "cell");
      return;
    }
    const mergeAt = findMerge(merges, address);
    if (mergeAt) {
      if (pressWasSelectedRef.current) {
        startEditing({ col: mergeAt.startCol, row: mergeAt.startRow }, "cell");
        return;
      }
      setSelection(rangeFromMerge(mergeAt));
      return;
    }
    if (pressWasSelectedRef.current) startEditing(address, "cell");
    else setSelection(address);
  }

  function toggleBoolean(address: Address) {
    const current = rawAt(address).trim().toUpperCase();
    const next = current === "TRUE" || current === "1" || current === "YES" ? "FALSE" : "TRUE";
    setCellValue(address, next);
    setSelection(address);
  }

  function formatAt(address: Address): SheetCellFormat | undefined {
    const column = columns[address.col];
    const row = rows[address.row];
    if (!column || !row) return undefined;
    return row.formats?.[column.id];
  }

  function applyFormat(patch: Partial<SheetCellFormat> | null) {
    const span = normalizedRange(range);
    // Clearing formats past the end has nothing to clear, so only a patch
    // that sets something grows the grid to cover the selection.
    const sets = patch != null && Object.values(patch).some((value) => value != null && value !== false);
    const grown = sets
      ? growGridTo({ columns, rows }, { col: span.maxCol, row: span.maxRow }, makeColumn, emptySheetRow)
      : { columns, rows };
    const nextRows = grown.rows.map((row) => ({
      ...row,
      formats: { ...(row.formats ?? {}) },
    }));
    visitRange(range, (address) => {
      const column = grown.columns[address.col];
      const row = nextRows[address.row];
      if (!column || !row) return;
      const current = { ...(row.formats[column.id] ?? {}) };
      const nextFormat = patch == null ? undefined : { ...current, ...patch };
      if (nextFormat) {
        for (const [key, value] of Object.entries(nextFormat)) {
          if (value == null || value === false) delete nextFormat[key as keyof SheetCellFormat];
        }
      }
      if (!nextFormat || Object.keys(nextFormat).length === 0) delete row.formats[column.id];
      else row.formats[column.id] = nextFormat;
    });
    commit({
      columns: grown.columns !== columns ? grown.columns : undefined,
      rows: nextRows.map((row) => ({
        ...row,
        formats: Object.keys(row.formats).length ? row.formats : undefined,
      })),
    });
  }

  function mergeSelection() {
    const span = normalizedRange(range);
    if (span.minCol === span.maxCol && span.minRow === span.maxRow) {
      if (selected.col >= columns.length - 1 || selected.row >= rows.length) return;
      commit({ merges: mergeAll(merges, { anchor: selected, focus: { col: selected.col + 1, row: selected.row } }) });
      return;
    }
    // A selection can reach past the end; merge only the cells that exist so
    // the merge doesn't cover (and later swallow) rows that aren't there.
    const maxCol = Math.min(span.maxCol, columns.length - 1);
    const maxRow = Math.min(span.maxRow, rows.length - 1);
    if (span.minCol > maxCol || span.minRow > maxRow) return;
    if (span.minCol === maxCol && span.minRow === maxRow) return;
    commit({
      merges: mergeAll(merges, {
        anchor: { col: span.minCol, row: span.minRow },
        focus: { col: maxCol, row: maxRow },
      }),
    });
  }

  function unmergeSelection() {
    commit({ merges: unmergeRange(merges, range) });
  }

  function insertFormula(template: (rangeLabel: string) => string) {
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
    startEditing(target, "formula", value);
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
    focusFormulaBar(caretRef.current);
    setDrawerOpen(false);
  }

  function colLeft(index: number) {
    let x = ROW_HEAD;
    for (let i = 0; i < index; i += 1) x += columns[i] ? colWidth(columns[i]) : GHOST_COL_W;
    return x;
  }

  function fillHandleBox() {
    const maxCol = bounds.maxCol;
    const maxRow = bounds.maxRow;
    const width = columns[maxCol] ? colWidth(columns[maxCol]) : GHOST_COL_W;
    return {
      x: colLeft(maxCol) + width - 12,
      y: HEADER_H + (maxRow + 1) * CELL_H - 12,
      width,
    };
  }

  function selectionBox() {
    const { minCol, maxCol, minRow, maxRow } = bounds;
    let width = 0;
    for (let col = minCol; col <= maxCol; col += 1) {
      width += columns[col] ? colWidth(columns[col]) : GHOST_COL_W;
    }
    return {
      left: colLeft(minCol),
      top: HEADER_H + minRow * CELL_H,
      width,
      height: (maxRow - minRow + 1) * CELL_H,
    };
  }

  function beginFill() {
    skipTapRef.current = true;
    dragModeRef.current = "fill";
    fillOriginRef.current = rangeRef.current;
    lockGrid(true);
  }

  function beginSelectFromHit(hit: HitZone) {
    skipTapRef.current = true;
    dragModeRef.current = "select";
    const lastRow = Math.max(rows.length - 1, 0);
    const lastCol = Math.max(columns.length - 1, 0);
    if (hit.zone === "col") {
      selectKindRef.current = "col";
      setSelection({
        anchor: { col: hit.col, row: 0 },
        focus: { col: hit.col, row: lastRow },
      });
    } else if (hit.zone === "row") {
      selectKindRef.current = "row";
      setSelection({
        anchor: { col: 0, row: hit.row },
        focus: { col: lastCol, row: hit.row },
      });
    } else {
      selectKindRef.current = "cell";
      setSelection({ col: hit.col, row: hit.row });
    }
    lockGrid(true);
  }

  function beginFormulaFromHit(hit: HitZone) {
    skipTapRef.current = true;
    const mode = hit.zone === "col" ? "formula-col" : hit.zone === "row" ? "formula-row" : "formula";
    beginFormulaPick({ col: hit.col, row: hit.row }, mode);
    lockGrid(true);
  }

  function endDrag(pageX?: number, pageY?: number) {
    const mode = dragModeRef.current;
    if (!mode) return;
    if (mode === "fill" && fillOriginRef.current && pageX != null && pageY != null) {
      const hit = addressFromPage(pageX, pageY);
      if (hit) fillRange(fillOriginRef.current, { col: hit.col, row: hit.row });
      skipTapRef.current = true;
    } else if (mode === "select") {
      const current = rangeRef.current;
      if (current.anchor.col !== current.focus.col || current.anchor.row !== current.focus.row) {
        skipTapRef.current = true;
      }
    } else if (mode.startsWith("formula")) {
      skipTapRef.current = true;
    }
    const wasFormula = mode.startsWith("formula");
    dragModeRef.current = null;
    fillOriginRef.current = null;
    selectKindRef.current = null;
    formulaPickOriginRef.current = null;
    lockGrid(false);
    setTimeout(() => {
      formulaPickingRef.current = false;
    }, 0);
    touchStartRef.current = null;
    dragOriginRef.current = null;
    if (wasFormula) focusFormulaBar(caretRef.current);
  }

  function onGridTouchMove(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    const mode = dragModeRef.current;
    if (!mode) return;
    const hit = addressFromPage(pageX, pageY);
    if (!hit) return;
    if (mode.startsWith("formula")) {
      extendFormulaPick({ col: hit.col, row: hit.row });
      return;
    }
    if (mode === "select" || mode === "fill") {
      if (mode === "select" && selectKindRef.current === "col") {
        setSelection({
          anchor: { col: rangeRef.current.anchor.col, row: 0 },
          focus: { col: hit.col, row: Math.max(rows.length - 1, 0) },
        });
        return;
      }
      if (mode === "select" && selectKindRef.current === "row") {
        setSelection({
          anchor: { col: 0, row: rangeRef.current.anchor.row },
          focus: { col: Math.max(columns.length - 1, 0), row: hit.row },
        });
        return;
      }
      setSelection({ col: hit.col, row: hit.row }, true);
    }
  }

  function onGridTouchEnd(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    endDrag(pageX, pageY);
  }

  const touchHandlersRef = useRef<{
    shouldCaptureStart: (event: GestureResponderEvent) => boolean;
    shouldCaptureMove: (event: GestureResponderEvent, gesture: PanResponderGestureState) => boolean;
    onMove: (event: GestureResponderEvent) => void;
    onEnd: (event: GestureResponderEvent) => void;
  }>({
    shouldCaptureStart: () => false,
    shouldCaptureMove: () => false,
    onMove: () => {},
    onEnd: () => {},
  });

  touchHandlersRef.current = {
    shouldCaptureStart: () => Boolean(dragModeRef.current),
    shouldCaptureMove: (_event, gesture) => {
      if (dragModeRef.current || gridLockedRef.current) return true;
      const dx = gesture.dx;
      const dy = gesture.dy;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return false;
      if (editingFormulaRef.current) {
        const origin = dragOriginRef.current?.hit;
        if (origin) beginFormulaFromHit(origin);
        return Boolean(origin);
      }
      if (Math.abs(dx) >= Math.abs(dy)) {
        const origin = dragOriginRef.current?.hit;
        if (origin?.zone === "cell" || origin?.zone === "col") {
          beginSelectFromHit(origin);
          return true;
        }
      }
      return false;
    },
    onMove: onGridTouchMove,
    onEnd: onGridTouchEnd,
  };

  const gridPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) =>
        touchHandlersRef.current.shouldCaptureStart(event),
      onMoveShouldSetPanResponderCapture: (event, gesture) =>
        touchHandlersRef.current.shouldCaptureMove(event, gesture),
      onMoveShouldSetPanResponder: (event, gesture) =>
        touchHandlersRef.current.shouldCaptureMove(event, gesture),
      onPanResponderMove: (event) => touchHandlersRef.current.onMove(event),
      onPanResponderRelease: (event) => touchHandlersRef.current.onEnd(event),
      onPanResponderTerminate: (event) => touchHandlersRef.current.onEnd(event),
      onPanResponderTerminationRequest: () => !dragModeRef.current && !gridLockedRef.current,
    }),
  ).current;

  const selectedFormat = formatAt(selected);
  const selectedRaw = editTextForCell(columns[selected.col]?.type, rawAt(selected));
  const contextCallback = useRef(onAssistantContext);
  contextCallback.current = onAssistantContext;
  const selectedValues = rows.slice(bounds.minRow, bounds.maxRow + 1).map((row) => ({ id: row.id, cells: Object.fromEntries(columns.slice(bounds.minCol, bounds.maxCol + 1).map((col) => [col.id, row.cells[col.id]])) }));
  const contextSnapshot = JSON.stringify({ range: selectionAddressLabel(range, merges), columns: columns.slice(bounds.minCol, bounds.maxCol + 1), rows: selectedValues, editing: editing ? { address: editing, value: draft } : undefined });
  useEffect(() => { contextCallback.current?.({ selection: contextSnapshot, filter: filterQuery, draft: editing ? draft : "" }); }, [contextSnapshot, filterQuery]);

  const selectedAddress = columns.length && rows.length ? selectionAddressLabel(range, merges) : "—";
  const mergeActive = hasMergeInRange(merges, range);
  const canMerge = bounds.minCol !== bounds.maxCol || bounds.minRow !== bounds.maxRow;
  const formulaEditActive = Boolean(editing && isFormulaValue(draft));

  const fitRow = cellFit ? rows.findIndex((row) => row.id === cellFit.rowId) : -1;
  const fitCol = cellFit ? columns.findIndex((column) => column.id === cellFit.columnId) : -1;
  // The hint shows while the cell still holds the entry it is about.
  const fitHint =
    cellFit &&
    cellFit.id !== dismissedFit &&
    fitRow >= 0 &&
    fitCol >= 0 &&
    String(rows[fitRow].cells?.[cellFit.columnId] ?? "").trim() === cellFit.value
      ? { ...cellFit, address: `${columnIndexToLetter(fitCol)}${fitRow + 1}` }
      : null;

  const displayCols = columns.length + ghostColCount;
  const ghostRowIndexes = Array.from({ length: ghostRowCount }, (_, i) => rows.length + i);
  const gridWidth = colLeft(displayCols);
  const pinWidth = colLeft(pinCols);
  const pinnedRowIndexes = visibleRowIndexes.filter((index) => index < pinRows);
  const scrolledRowIndexes = visibleRowIndexes.filter((index) => index >= pinRows);
  const pinHeight = HEADER_H + pinnedRowIndexes.length * CELL_H;
  // The selection outline and fill handle ride in the layer that holds the
  // selection's bottom-right cell, so they move with the cells they mark.
  const selectionLayer =
    bounds.maxRow < pinRows
      ? bounds.maxCol < pinCols ? "corner" : "top"
      : bounds.maxCol < pinCols ? "left" : "body";

  function renderHeaderCells(from: number, to: number) {
    return Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
      const index = from + offset;
      const column = columns[index];
      if (column?.hidden) return null;
      const width = column ? colWidth(column) : GHOST_COL_W;
      return (
        <Pressable
          key={column?.id ?? `ghost-col-${index}`}
          onPressIn={(event) => {
            noteTouch(
              { zone: "col", col: index, row: 0 },
              event.nativeEvent.pageX,
              event.nativeEvent.pageY,
              event.nativeEvent.locationX,
              event.nativeEvent.locationY,
            );
            if (isEditingFormula()) {
              beginFormulaFromHit({ zone: "col", col: index, row: 0 });
              return;
            }
            if (column) setSelection({ col: index, row: selected.row });
            else selectGrown({ col: index, row: Math.max(0, selected.row) });
          }}
          onPress={() => {
            if (skipTapRef.current) {
              skipTapRef.current = false;
              if (dragModeRef.current?.startsWith("formula")) endDrag();
            }
          }}
          onLongPress={() => {
            if (column && !isEditingFormula()) setColumnMenu(index);
          }}
          delayLongPress={450}
          style={[
            styles.headCell,
            { width },
            index >= bounds.minCol && index <= bounds.maxCol && styles.selectedHead,
            formulaRanges.some((picked) => rangeTouchesCol(picked, index)) && styles.formulaHead,
          ]}
        >
          <Text style={styles.letter}>{columnIndexToLetter(index)}</Text>
          {column && renaming === index && !formulaEditActive ? (
            <TextInput
              autoFocus
              value={renameDraft}
              onChangeText={setRenameDraft}
              onBlur={() => {
                renameColumn(index, renameDraft);
                setRenaming(null);
              }}
              onSubmitEditing={() => {
                renameColumn(index, renameDraft);
                setRenaming(null);
              }}
              style={styles.rename}
            />
          ) : column ? (
            formulaEditActive ? (
              <Text numberOfLines={1} style={styles.headName}>{column.name}</Text>
            ) : (
              <Pressable
                onPress={() => {
                  setRenameDraft(column.name);
                  setRenaming(index);
                }}
                style={styles.headNameHit}
              >
                <Text numberOfLines={1} style={styles.headName}>{column.name}</Text>
              </Pressable>
            )
          ) : null}
          {column && !formulaEditActive ? (
            <Pressable onPress={() => setTypeMenu(index)} style={styles.typeBadge}>
              <Text style={styles.typeText}>{columnTypeBadge(column.type)}</Text>
            </Pressable>
          ) : column ? (
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{columnTypeBadge(column.type)}</Text>
            </View>
          ) : null}
        </Pressable>
      );
    });
  }

  /** One row's cells from column `from` up to `to`. Starting at 0 adds the row
   * number; starting later leaves room for the pinned part drawn above it. */
  function renderDataRow(rowIndex: number, from: number, to: number) {
    const row = rows[rowIndex];
    if (!row) return null;
    const rowHasVerticalMerge = merges.some(
      (item) => item.startRow === rowIndex && item.rowSpan > 1,
    );
    return (
      <View
        key={row.id}
        style={[styles.tr, rowHasVerticalMerge && styles.mergeOriginRow]}
        collapsable={false}
      >
        {from === 0 ? (
          <Pressable
            onPressIn={(event) => {
              noteTouch(
                { zone: "row", col: 0, row: rowIndex },
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                event.nativeEvent.locationX,
                event.nativeEvent.locationY,
              );
              const current = rangeRef.current;
              pressWasSelectedRef.current =
                current.anchor.row === rowIndex && current.focus.row === rowIndex
                && current.anchor.col === 0 && current.focus.col === Math.max(columns.length - 1, 0);
              if (isEditingFormula()) {
                beginFormulaFromHit({ zone: "row", col: 0, row: rowIndex });
                return;
              }
              if (!pressWasSelectedRef.current) {
                setSelection({ col: selected.col, row: rowIndex });
              }
            }}
            onLongPress={() => {
              if (isEditingFormula()) beginFormulaFromHit({ zone: "row", col: 0, row: rowIndex });
              else beginSelectFromHit({ zone: "row", col: 0, row: rowIndex });
            }}
            delayLongPress={450}
            onPress={() => {
              if (skipTapRef.current) {
                skipTapRef.current = false;
                if (dragModeRef.current?.startsWith("formula")) endDrag();
                return;
              }
              setSelection({ col: selected.col, row: rowIndex });
            }}
            style={[
              styles.rowHead,
              rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow && styles.selectedHead,
              formulaRanges.some((picked) => rangeTouchesRow(picked, rowIndex)) && styles.formulaHead,
            ]}
          >
            <Text style={styles.rowNum}>{rowIndex + 1}</Text>
          </Pressable>
        ) : (
          <View pointerEvents="none" style={{ width: pinWidth, height: CELL_H }} />
        )}
        {Array.from({ length: Math.max(0, to - from) }, (_, offset) =>
          renderCell({
            colIndex: from + offset,
            rowIndex,
            row,
            selected,
            range,
            formulaRanges,
            editing,
            editSource,
            draft,
            setDraft,
            commitEdit,
            tapCell,
            tapSelectCell,
            cellInputRef,
            onCellPressIn,
            onCellLongPress,
            toggleBoolean,
            evaluator,
            columns,
            merges,
            colWidth,
            rawAt,
            filtering,
            pinEdge: pinCols,
            conditional: conditional.get(`${from + offset}:${rowIndex}`),
          }),
        )}
      </View>
    );
  }

  function renderGhostRow(rowIndex: number, from: number, to: number) {
    return (
      <View key={`ghost-row-${rowIndex}`} style={styles.tr} collapsable={false}>
        {from === 0 ? (
          <Pressable
            onPressIn={(event) => {
              noteTouch(
                { zone: "row", col: 0, row: rowIndex },
                event.nativeEvent.pageX,
                event.nativeEvent.pageY,
                event.nativeEvent.locationX,
                event.nativeEvent.locationY,
              );
              if (isEditingFormula()) {
                beginFormulaFromHit({ zone: "row", col: 0, row: rowIndex });
              }
            }}
            onPress={() => {
              if (skipTapRef.current) {
                skipTapRef.current = false;
                if (dragModeRef.current?.startsWith("formula")) endDrag();
                return;
              }
              if (isEditingFormula()) {
                beginFormulaPick({ col: 0, row: rowIndex }, "formula-row");
                return;
              }
              selectGrown({ col: Math.max(0, selected.col), row: rowIndex });
            }}
            style={styles.rowHead}
          >
            <Text style={styles.rowNum}>{rowIndex + 1}</Text>
          </Pressable>
        ) : (
          <View pointerEvents="none" style={{ width: pinWidth, height: CELL_H }} />
        )}
        {Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
          const colIndex = from + offset;
          return columns[colIndex]?.hidden ? null : (
            <Pressable
              key={`ghost-${rowIndex}-${colIndex}`}
              onPressIn={(event) => onCellPressIn(colIndex, rowIndex, event)}
              onLongPress={() => onCellLongPress(colIndex, rowIndex)}
              delayLongPress={450}
              onPress={() => tapCell({ col: colIndex, row: rowIndex })}
              style={[
                styles.cell,
                { width: columns[colIndex] ? colWidth(columns[colIndex]) : GHOST_COL_W },
                isInRange({ col: colIndex, row: rowIndex }, range) && styles.rangeCell,
                selected.col === colIndex && selected.row === rowIndex && styles.selectedCell,
              ]}
            />
          );
        })}
      </View>
    );
  }

  const selectionDecor = (
    <>
      {!editing && !isEditingFormula() ? (
        <Pressable
          onPressIn={(event) => {
            const box = fillHandleBox();
            noteTouch(
              { zone: "cell", col: bounds.maxCol, row: bounds.maxRow },
              event.nativeEvent.pageX,
              event.nativeEvent.pageY,
              box.width,
              CELL_H,
            );
            beginFill();
          }}
          hitSlop={8}
          style={[
            styles.fillHandle,
            { left: fillHandleBox().x, top: fillHandleBox().y },
          ]}
        />
      ) : null}
      {bounds.minCol !== bounds.maxCol || bounds.minRow !== bounds.maxRow ? (
        <View
          pointerEvents="none"
          style={[styles.selectionOverlay, selectionBox()]}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.root} collapsable={false}>
      <View style={styles.toolbar}>
        <View style={styles.formulaRow}>
          <Text style={styles.addr}>{selectedAddress}</Text>
          <Text style={styles.fx}>fx</Text>
          <TextInput
            ref={formulaInputRef}
            value={editing ? draft : selectedRaw}
            onFocus={() => {
              if (!editing) startEditing(selected, "formula");
              else setEditSource("formula");
            }}
            onSelectionChange={(event) => {
              caretRef.current = event.nativeEvent.selection.start;
            }}
            onChangeText={(value) => {
              formulaSpanRef.current = null;
              setFormulaRanges([]);
              if (!editing) startEditing(selected, "formula", value);
              else setDraft(value);
            }}
            onSubmitEditing={commitEdit}
            onBlur={() => {
              if (formulaPickingRef.current) return;
              if (editing && editSource === "formula") commitEdit();
            }}
            placeholder="Value or =SUM(A1:A5)"
            placeholderTextColor={colors.mutedForeground}
            style={styles.formula}
          />
          <Pressable
            accessibilityLabel="Functions"
            onPress={() => {
              setDrawerTab("functions");
              setDrawerOpen(true);
            }}
            style={styles.formulaAction}
          >
            <Sigma size={16} color={KINETIC.secondary} />
          </Pressable>
          <Pressable
            accessibilityLabel="Filter rows"
            onPress={() => setFilterOpen((open) => !open)}
            style={[styles.formulaAction, showFilter && styles.formulaActionOn]}
          >
            <Filter size={15} color={showFilter ? KINETIC.text : KINETIC.secondary} />
          </Pressable>
        </View>
        {showFilter ? (
          <View style={styles.filterRow}>
            <TextInput
              value={filterQuery}
              onChangeText={setFilterQuery}
              placeholder="Filter rows..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.filterInput}
            />
            {filterQuery ? (
              <Text style={styles.filterCount}>
                {visibleRowIndexes.length}/{rows.length}
              </Text>
            ) : null}
          </View>
        ) : null}
        {fitHint ? (
          <View style={styles.fitRow} accessibilityRole="alert">
            <Pressable accessibilityLabel={`Go to cell ${fitHint.address}`} onPress={() => setSelection({ col: fitCol, row: fitRow })}>
              <Text style={styles.fitAddr}>{fitHint.address}</Text>
            </Pressable>
            <Text style={styles.fitText} numberOfLines={2}>
              {fitHint.hint}
            </Text>
            <Pressable
              accessibilityLabel="Dismiss hint"
              hitSlop={8}
              onPress={() => {
                if (fitHint.logId) fitFeedback.mutate({ logId: fitHint.logId, accepted: false });
                setDismissedFit(fitHint.id);
              }}
              style={styles.fitClose}
            >
              <Text style={styles.fitCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        ref={gridViewportRef}
        style={styles.gridViewport}
        onLayout={onGridLayout}
        collapsable={false}
      >
        {viewport.width > 0 && viewport.height > 0 ? (
          <View
            collapsable={false}
            style={{ width: viewport.width, height: viewport.height }}
            {...gridPan.panHandlers}
          >
          <Animated.ScrollView
            style={{ width: viewport.width, height: viewport.height }}
            contentContainerStyle={{ minHeight: viewport.height }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            removeClippedSubviews={false}
            bounces={false}
            scrollEnabled={!gridLocked && !formulaEditActive}
            canCancelContentTouches={!gridLocked && !formulaEditActive}
            onScroll={onScrollY}
            scrollEventThrottle={16}
          >
            <Animated.ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="always"
              removeClippedSubviews={false}
              bounces={false}
              scrollEnabled={!gridLocked && !formulaEditActive}
              canCancelContentTouches={!gridLocked && !formulaEditActive}
              onScroll={onScrollX}
              scrollEventThrottle={16}
            >
              {/* Four layers share the content's top-left corner. The body
                  scrolls; the pinned column, the pinned rows and their corner
                  slide back by the scroll offset so they stay in view. */}
              <View collapsable={false} style={{ position: "relative" }}>
                <View collapsable={false} style={styles.bodyLayer}>
                  <View style={{ width: gridWidth, height: pinHeight }} />
                  {scrolledRowIndexes.map((rowIndex) => renderDataRow(rowIndex, pinCols, displayCols))}
                  {ghostRowIndexes.map((rowIndex) => renderGhostRow(rowIndex, pinCols, displayCols))}
                  {selectionLayer === "body" ? selectionDecor : null}
                </View>
                <Animated.View collapsable={false} pointerEvents="box-none" style={[styles.pinLayer, styles.pinLeft, pinX]}>
                  <View pointerEvents="none" style={{ width: pinWidth, height: pinHeight }} />
                  {scrolledRowIndexes.map((rowIndex) => renderDataRow(rowIndex, 0, pinCols))}
                  {ghostRowIndexes.map((rowIndex) => renderGhostRow(rowIndex, 0, pinCols))}
                  {pinCols > 0 ? <View pointerEvents="none" style={[styles.freezeEdgeCol, { left: pinWidth - 2 }]} /> : null}
                  {selectionLayer === "left" ? selectionDecor : null}
                </Animated.View>
                <Animated.View collapsable={false} pointerEvents="box-none" style={[styles.pinLayer, styles.pinTop, pinY]}>
                  <View style={styles.tr} collapsable={false}>
                    <View pointerEvents="none" style={{ width: pinWidth, height: HEADER_H }} />
                    {renderHeaderCells(pinCols, displayCols)}
                  </View>
                  {pinnedRowIndexes.map((rowIndex) => renderDataRow(rowIndex, pinCols, displayCols))}
                  {pinRows > 0 ? <View pointerEvents="none" style={[styles.freezeEdgeRow, { top: pinHeight - 2 }]} /> : null}
                  {selectionLayer === "top" ? selectionDecor : null}
                </Animated.View>
                <Animated.View collapsable={false} pointerEvents="box-none" style={[styles.pinLayer, styles.pinCorner, pinXY]}>
                  <View style={styles.tr} collapsable={false}>
                    <View style={[styles.rowHead, styles.headCell]} />
                    {renderHeaderCells(0, pinCols)}
                  </View>
                  {pinnedRowIndexes.map((rowIndex) => renderDataRow(rowIndex, 0, pinCols))}
                  {pinCols > 0 ? <View pointerEvents="none" style={[styles.freezeEdgeCol, { left: pinWidth - 2 }]} /> : null}
                  {pinRows > 0 ? <View pointerEvents="none" style={[styles.freezeEdgeRow, { top: pinHeight - 2 }]} /> : null}
                  {selectionLayer === "corner" ? selectionDecor : null}
                </Animated.View>
              </View>
            </Animated.ScrollView>
          </Animated.ScrollView>
          </View>
        ) : null}
      </View>

      <View style={[styles.drawer, !drawerOpen && styles.drawerCollapsed]}>
        <Pressable
          accessibilityLabel={drawerOpen ? "Collapse formatting drawer" : "Open formatting drawer"}
          hitSlop={{ top: 10, bottom: 10, left: 24, right: 24 }}
          onPress={() => setDrawerOpen((open) => !open)}
          style={styles.drawerHandleHit}
        >
          <View style={styles.drawerHandle} />
        </Pressable>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.drawerTabsScroll}
          contentContainerStyle={styles.drawerTabs}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        >
          <DrawerTabButton label="Format" tab="format" active={drawerTab} onPress={setDrawerTab} />
          <DrawerTabButton label="123 Numbers & Data" tab="numbers" active={drawerTab} onPress={setDrawerTab} />
          <DrawerTabButton label="+ Insert & Tools" tab="insert" active={drawerTab} onPress={setDrawerTab} />
          <DrawerTabButton label="Σ Functions" tab="functions" active={drawerTab} onPress={setDrawerTab} />
        </ScrollView>
        {drawerOpen ? (
          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            keyboardShouldPersistTaps="handled"
          >
            {drawerTab === "format" ? (
              <>
                <View style={styles.actionStrip}>
                  <Tool icon={<Undo2 size={16} color={KINETIC.text} />} caption="Undo" disabled={past.length === 0} onPress={undo} />
                  <Tool icon={<Redo2 size={16} color={KINETIC.text} />} caption="Redo" disabled={future.length === 0} onPress={redo} />
                  <Tool icon={<Eraser size={16} color={KINETIC.text} />} caption="Clear" onPress={clearSelection} />
                  <Tool icon={<PaintBucket size={16} color={selectedFormat?.fillColor || KINETIC.text} />} caption="Fill" onPress={() => setFillOpen(true)} />
                </View>
                <Text style={styles.sectionLabel}>FONT & STYLE</Text>
                <View style={styles.controlRow}>
                  <Pressable onPress={() => applyFormat({ fontFamily: selectedFormat?.fontFamily === "mono" ? undefined : "mono" })} style={[styles.wideControl, selectedFormat?.fontFamily === "mono" && styles.controlOn]}>
                    <Text style={styles.controlText}>{selectedFormat?.fontFamily === "mono" ? "JetBrains Mono" : "Inter"}</Text>
                  </Pressable>
                  <Pressable onPress={() => applyFormat({ fontSize: Math.max(8, (selectedFormat?.fontSize ?? 13) - 1) })} style={styles.stepControl}><Minus size={14} color={KINETIC.text} /></Pressable>
                  <View style={styles.sizeReadout}><Text style={styles.controlText}>{selectedFormat?.fontSize ?? 13}</Text></View>
                  <Pressable onPress={() => applyFormat({ fontSize: Math.min(28, (selectedFormat?.fontSize ?? 13) + 1) })} style={styles.stepControl}><Plus size={14} color={KINETIC.text} /></Pressable>
                </View>
                <View style={styles.actionStrip}>
                  <Tool icon={<Bold size={16} color={KINETIC.text} />} caption="Bold" active={Boolean(selectedFormat?.bold)} onPress={() => applyFormat({ bold: !selectedFormat?.bold })} />
                  <Tool icon={<Italic size={16} color={KINETIC.text} />} caption="Italic" active={Boolean(selectedFormat?.italic)} onPress={() => applyFormat({ italic: !selectedFormat?.italic })} />
                  <Tool icon={<Underline size={16} color={KINETIC.text} />} caption="Underline" active={Boolean(selectedFormat?.underline)} onPress={() => applyFormat({ underline: !selectedFormat?.underline })} />
                  <Tool icon={<Strikethrough size={16} color={KINETIC.text} />} caption="Strike" active={Boolean(selectedFormat?.strikethrough)} onPress={() => applyFormat({ strikethrough: !selectedFormat?.strikethrough })} />
                </View>
                <Text style={styles.sectionLabel}>ALIGNMENT & WRAP</Text>
                <View style={styles.actionStrip}>
                  <Tool icon={<AlignLeft size={16} color={KINETIC.text} />} caption="Left" active={selectedFormat?.align === "left"} onPress={() => applyFormat({ align: "left" })} />
                  <Tool icon={<AlignCenter size={16} color={KINETIC.text} />} caption="Center" active={selectedFormat?.align === "center"} onPress={() => applyFormat({ align: "center" })} />
                  <Tool icon={<AlignRight size={16} color={KINETIC.text} />} caption="Right" active={selectedFormat?.align === "right"} onPress={() => applyFormat({ align: "right" })} />
                  <Tool icon={<WrapText size={16} color={KINETIC.text} />} caption="Wrap" active={Boolean(selectedFormat?.wrap)} onPress={() => applyFormat({ wrap: !selectedFormat?.wrap })} />
                </View>
              </>
            ) : drawerTab === "numbers" ? (
              <>
                <Text style={styles.sectionLabel}>NUMBER FORMAT</Text>
                <View style={styles.actionStrip}>
                  <Tool icon={<Hash size={16} color={KINETIC.text} />} caption="Number" active={selectedFormat?.numberFormat === "number"} onPress={() => applyFormat({ numberFormat: "number" })} />
                  <Tool icon={<DollarSign size={16} color={KINETIC.text} />} caption="Currency" active={selectedFormat?.numberFormat === "currency"} onPress={() => applyFormat({ numberFormat: "currency" })} />
                  <Tool icon={<Percent size={16} color={KINETIC.text} />} caption="Percent" active={selectedFormat?.numberFormat === "percent"} onPress={() => applyFormat({ numberFormat: "percent" })} />
                  <Tool icon={<Eraser size={16} color={KINETIC.text} />} caption="Plain" active={!selectedFormat?.numberFormat} onPress={() => applyFormat({ numberFormat: undefined, decimals: undefined })} />
                </View>
                <Text style={styles.sectionLabel}>DECIMAL PLACES</Text>
                <View style={styles.controlRow}>
                  <Pressable onPress={() => applyFormat({ decimals: Math.max(0, (selectedFormat?.decimals ?? 2) - 1) })} style={styles.wideControl}><Text style={styles.controlText}>Decrease .0</Text></Pressable>
                  <View style={styles.sizeReadout}><Text style={styles.controlText}>{selectedFormat?.decimals ?? 2}</Text></View>
                  <Pressable onPress={() => applyFormat({ decimals: Math.min(10, (selectedFormat?.decimals ?? 2) + 1) })} style={styles.wideControl}><Text style={styles.controlText}>Increase .00</Text></Pressable>
                </View>
              </>
            ) : drawerTab === "insert" ? (
              <>
                <Text style={styles.sectionLabel}>INSERT</Text>
                <View style={styles.actionStrip}>
                  <Tool icon={<Plus size={16} color={KINETIC.text} />} caption="Row above" onPress={() => addRow(selected.row)} />
                  <Tool icon={<Plus size={16} color={KINETIC.text} />} caption="Row below" onPress={() => addRow(selected.row + 1)} />
                  <Tool icon={<Plus size={16} color={KINETIC.text} />} caption="Col left" onPress={() => addColumn(selected.col)} />
                  <Tool icon={<Plus size={16} color={KINETIC.text} />} caption="Col right" onPress={() => addColumn(selected.col + 1)} />
                </View>
                <Text style={styles.sectionLabel}>TOOLS</Text>
                <View style={styles.actionStrip}>
                  <Tool icon={<Combine size={16} color={KINETIC.text} />} caption="Merge" disabled={!canMerge && !mergeActive} onPress={mergeSelection} />
                  <Tool icon={<Ungroup size={16} color={KINETIC.text} />} caption="Unmerge" disabled={!mergeActive} onPress={unmergeSelection} />
                  <Tool icon={<Trash2 size={16} color="#EF6B5C" />} caption="Delete row" disabled={rows.length <= 1} onPress={() => deleteRow(selected.row)} />
                  <Tool icon={<Trash2 size={16} color="#EF6B5C" />} caption="Delete col" disabled={columns.length <= 1} onPress={() => deleteColumn(selected.col)} />
                </View>
                <Text style={styles.sectionLabel}>FREEZE</Text>
                <FreezePicker
                  label="Rows"
                  value={frozenRows}
                  upTo={selected.row + 1}
                  name={(count) => String(count)}
                  onPick={(count) => setFrozen({ frozenRows: count })}
                />
                <FreezePicker
                  label="Columns"
                  value={frozenCols}
                  upTo={selected.col + 1}
                  name={(count) => columnIndexToLetter(count - 1)}
                  onPick={(count) => setFrozen({ frozenCols: count })}
                />
                {pinRows < Math.min(frozenRows, rows.length) || pinCols < Math.min(frozenCols, columns.length) ? (
                  <Text style={styles.freezeNote}>
                    {pinCols < Math.min(frozenCols, columns.length)
                      ? `This screen pins the first ${pinCols === 1 ? "column" : `${pinCols} columns`} so there is room to scroll.`
                      : `This screen pins the first ${pinRows === 1 ? "row" : `${pinRows} rows`} so there is room to scroll.`}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {FORMULA_GROUPS.map((group) => (
                  <View key={group.title} style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{group.title}</Text>
                    <View style={styles.functionGrid}>
                      {group.items.map((item) => (
                        <Pressable
                          key={item.label}
                          onPress={() => insertFormula(item.template)}
                          style={styles.functionButton}
                        >
                          <Text style={styles.functionText}>{item.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        ) : null}
      </View>

      <BottomSheet open={columnMenu !== null} onClose={() => setColumnMenu(null)} title="Column">
        <SheetOption
          onSelect={() => {
            if (columnMenu !== null) {
              setRenameDraft(columns[columnMenu]?.name ?? "");
              setRenaming(columnMenu);
            }
            setColumnMenu(null);
          }}
        >
          Rename
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setTypeMenu(columnMenu);
            setColumnMenu(null);
          }}
        >
          Change type
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (columnMenu !== null) sortColumn(columnMenu, 1);
            setColumnMenu(null);
          }}
        >
          Sort A → Z
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (columnMenu !== null) sortColumn(columnMenu, -1);
            setColumnMenu(null);
          }}
        >
          Sort Z → A
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setFilterOpen(true);
            setColumnMenu(null);
          }}
        >
          Filter rows…
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (columnMenu !== null) addColumn(columnMenu + 1);
            setColumnMenu(null);
          }}
        >
          Insert column right
        </SheetOption>
        {columns.length - hiddenCount > 1 ? (
          <SheetOption
            onSelect={() => {
              if (columnMenu !== null) setColumnHidden(columnMenu, true);
              setColumnMenu(null);
            }}
          >
            Hide column
          </SheetOption>
        ) : null}
        {hiddenCount > 0 ? (
          <SheetOption
            onSelect={() => {
              showHiddenColumns();
              setColumnMenu(null);
            }}
          >
            {hiddenCount === 1 ? "Show 1 hidden column" : `Show ${hiddenCount} hidden columns`}
          </SheetOption>
        ) : null}
        {columnMenu !== null ? (
          <SheetOption
            onSelect={() => {
              setFrozen({ frozenCols: frozenCols === columnMenu + 1 ? 0 : columnMenu + 1 });
              setColumnMenu(null);
            }}
          >
            {frozenCols === columnMenu + 1 ? "Unfreeze columns" : `Freeze up to column ${columnIndexToLetter(columnMenu)}`}
          </SheetOption>
        ) : null}
        <SheetOption
          onSelect={() => {
            if (columnMenu !== null) deleteColumn(columnMenu);
            setColumnMenu(null);
          }}
          leading={<Trash2 size={16} color={colors.destructive} />}
        >
          Delete column
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={typeMenu !== null} onClose={() => setTypeMenu(null)} title="Column type">
        {SHEET_COLUMN_TYPES.map((type) => (
          <SheetOption
            key={type.value}
            selected={typeMenu !== null && columns[typeMenu]?.type === type.value}
            onSelect={() => {
              if (typeMenu !== null) setColumnType(typeMenu, type.value);
              setTypeMenu(null);
            }}
          >
            {type.label}
          </SheetOption>
        ))}
        {typeMenu !== null && columns[typeMenu]?.type === "select" ? (
          <SheetOption
            onSelect={() => {
              const index = typeMenu;
              setTypeMenu(null);
              openOptionsEditor(index);
            }}
          >
            Edit dropdown options…
          </SheetOption>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={selectMenu !== null}
        onClose={() => setSelectMenu(null)}
        title={(selectMenu && columns[selectMenu.col]?.name) || "Choose"}
      >
        {(selectMenu ? (columns[selectMenu.col]?.options ?? []) : []).map((option) => (
          <SheetOption
            key={option}
            selected={selectMenu !== null && rawAt(selectMenu).trim() === option}
            onSelect={() => {
              if (selectMenu) setCellValue(selectMenu, option);
              setSelectMenu(null);
            }}
          >
            {option}
          </SheetOption>
        ))}
        {selectMenu && rawAt(selectMenu).trim() ? (
          <SheetOption
            onSelect={() => {
              setCellValue(selectMenu, "");
              setSelectMenu(null);
            }}
            leading={<Eraser size={16} color={KINETIC.text} />}
          >
            Clear
          </SheetOption>
        ) : null}
        <SheetOption
          onSelect={() => {
            const address = selectMenu;
            setSelectMenu(null);
            if (address) startEditing(address, "cell", "");
          }}
          leading={<Plus size={16} color={KINETIC.text} />}
        >
          Add option…
        </SheetOption>
        <SheetOption
          onSelect={() => {
            const address = selectMenu;
            setSelectMenu(null);
            if (address) openOptionsEditor(address.col);
          }}
        >
          Edit options…
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={optionsEditor !== null} onClose={closeOptionsEditor} title="Dropdown options">
        <TextInput
          ref={optionsInputRef}
          multiline
          value={optionsDraft}
          onChangeText={setOptionsDraft}
          placeholder="One option per line"
          placeholderTextColor={colors.mutedForeground}
          style={styles.optionsInput}
        />
        <Text style={styles.optionsHint}>Values already in the column stay listed.</Text>
        <SheetOption onSelect={saveOptions}>Save</SheetOption>
      </BottomSheet>

      <BottomSheet open={fillOpen} onClose={() => setFillOpen(false)} title="Fill color">
        <SheetOption
          selected={!selectedFormat?.fillColor}
          onSelect={() => {
            applyFormat({ fillColor: undefined });
            setFillOpen(false);
          }}
        >
          None
        </SheetOption>
        {FILL_SWATCHES.map((color) => (
          <SheetOption
            key={color}
            selected={selectedFormat?.fillColor === color}
            leading={<View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color }} />}
            onSelect={() => {
              applyFormat({ fillColor: color });
              setFillOpen(false);
            }}
          >
            {color}
          </SheetOption>
        ))}
      </BottomSheet>
    </View>
  );
}

function DrawerTabButton({
  label,
  tab,
  active,
  onPress,
}: {
  label: string;
  tab: DrawerTab;
  active: DrawerTab;
  onPress: (tab: DrawerTab) => void;
}) {
  const selected = tab === active;
  return (
    <Pressable onPress={() => onPress(tab)} style={[styles.drawerTab, selected && styles.drawerTabOn]}>
      <Text style={[styles.drawerTabText, selected && styles.drawerTabTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** None, 1, 2, or everything up to the selected cell, like the desktop freeze menu. */
function FreezePicker({
  label,
  value,
  upTo,
  name,
  onPick,
}: {
  label: string;
  value: number;
  upTo: number;
  /** How the last frozen row or column reads ("5" or "C"). */
  name: (count: number) => string;
  onPick: (count: number) => void;
}) {
  const options = [0, 1, 2];
  if (value > 2) options.push(value);
  if (upTo > 2 && upTo !== value) options.push(upTo);
  options.sort((a, b) => a - b);
  return (
    <View style={styles.freezeRow}>
      <Text style={styles.freezeLabel}>{label}</Text>
      {options.map((count) => (
        <Pressable
          key={count}
          accessibilityRole="button"
          accessibilityState={{ selected: value === count }}
          accessibilityLabel={count === 0 ? `Freeze no ${label.toLowerCase()}` : `Freeze ${label.toLowerCase()} up to ${name(count)}`}
          onPress={() => onPick(count)}
          style={[styles.freezeChip, value === count && styles.controlOn]}
        >
          <Text style={styles.controlText} numberOfLines={1}>
            {count === 0 ? "None" : count > 2 ? `To ${name(count)}` : String(count)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Tool({
  icon,
  caption,
  onPress,
  active,
  disabled,
}: {
  icon: ReactNode;
  caption?: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={caption}
      disabled={disabled}
      onPress={onPress}
      style={[styles.tableTool, active && styles.toolOn, disabled && { opacity: 0.35 }]}
    >
      {icon}
      {caption ? <Text style={styles.tableCaption}>{caption}</Text> : null}
    </Pressable>
  );
}

// Hidden columns keep their index (letters, formulas, selection) but take
// no room, so every position computed from widths skips them.
function naturalColWidth(column: SheetColumn) {
  return column.hidden ? 0 : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, column.width || 140));
}

function renderCell({
  colIndex,
  rowIndex,
  row,
  selected,
  range,
  formulaRanges,
  editing,
  editSource,
  draft,
  setDraft,
  commitEdit,
  tapCell,
  tapSelectCell,
  cellInputRef,
  onCellPressIn,
  onCellLongPress,
  toggleBoolean,
  evaluator,
  columns,
  merges,
  colWidth,
  rawAt,
  filtering,
  pinEdge,
  conditional,
}: {
  colIndex: number;
  rowIndex: number;
  row: SheetRow;
  selected: Address;
  range: CellRange;
  formulaRanges: CellRange[];
  editing: Address | null;
  editSource: "formula" | "cell" | null;
  draft: string;
  setDraft: (value: string) => void;
  commitEdit: () => void;
  tapCell: (address: Address) => void;
  tapSelectCell: (address: Address) => void;
  cellInputRef: RefObject<TextInput | null>;
  onCellPressIn: (col: number, row: number, event: GestureResponderEvent) => void;
  onCellLongPress: (col: number, row: number) => void;
  toggleBoolean: (address: Address) => void;
  evaluator: ReturnType<typeof createSheetEvaluator>;
  columns: SheetColumn[];
  merges: SheetMerge[];
  colWidth: (column: SheetColumn) => number;
  rawAt: (address: Address) => string;
  filtering: boolean;
  /** First column past the pinned ones; merges reaching across it leave gaps to hold. */
  pinEdge: number;
  conditional?: ConditionalStyle;
}) {
  const column = columns[colIndex];
  const address = { col: colIndex, row: rowIndex };
  if (column?.hidden) return null;
  if (!column) {
    return (
      <Pressable
        key={`ghost-cell-${rowIndex}-${colIndex}`}
        onPressIn={(event) => onCellPressIn(colIndex, rowIndex, event)}
        onLongPress={() => onCellLongPress(colIndex, rowIndex)}
        delayLongPress={450}
        onPress={() => tapCell(address)}
        style={[
          styles.cell,
          { width: GHOST_COL_W },
          isInRange(address, range) && styles.rangeCell,
          selected.col === colIndex && selected.row === rowIndex && styles.selectedCell,
        ]}
      />
    );
  }
  const merge = merges.find(
    (item) =>
      colIndex >= item.startCol &&
      colIndex < item.startCol + item.colSpan &&
      rowIndex >= item.startRow &&
      rowIndex < item.startRow + item.rowSpan,
  );
  if (merge && merge.startCol < pinEdge && colIndex >= pinEdge) {
    // The merged cell is drawn in the pinned layer; this part of the scrolled
    // layer keeps its width so the cells after it stay in their columns.
    return <View key={`pin-merge-${rowIndex}-${colIndex}`} pointerEvents="none" style={{ width: colWidth(column), height: CELL_H }} />;
  }
  const collapseVertical = Boolean(filtering && merge && merge.rowSpan > 1);
  if (
    collapseVertical &&
    merge &&
    rowIndex === merge.startRow &&
    colIndex !== merge.startCol
  ) {
    return null;
  }
  if (merge && (merge.startCol !== colIndex || merge.startRow !== rowIndex) && !collapseVertical) {
    if (rowIndex === merge.startRow) return null;
    if (colIndex !== merge.startCol) return null;
    const spacerWidth = columns
      .slice(merge.startCol, merge.startCol + merge.colSpan)
      .reduce((sum, item) => sum + colWidth(item), 0);
    return (
      <Pressable
        key={`merge-cover-${rowIndex}-${colIndex}`}
        onPressIn={(event) => onCellPressIn(merge.startCol, merge.startRow, event)}
        onLongPress={() => onCellLongPress(merge.startCol, merge.startRow)}
        delayLongPress={450}
        onPress={() => tapCell({ col: merge.startCol, row: merge.startRow })}
        style={[styles.mergeSpacer, { width: spacerWidth }]}
      />
    );
  }
  const displayMerge =
    merge && merge.startCol === colIndex && merge.startRow === rowIndex
      ? collapseVertical
        ? { ...merge, rowSpan: 1 }
        : merge
      : null;
  const isSelected = selected.col === colIndex && selected.row === rowIndex;
  const inRange = isInRange(address, range);
  const inFormulaRange = isInAnyRange(address, formulaRanges);
  const isEditing = editing?.col === colIndex && editing?.row === rowIndex;
  const result = evaluator.valueAt(colIndex, rowIndex);
  const format = row.formats?.[column.id];
  const raw = rawAt(address);
  const display = formatSheetCell(result, column, raw, format);
  // Conditional formats win over the cell's own colours, as in spreadsheets.
  const fillColor = conditional?.fillColor ?? format?.fillColor;
  const textColor = conditional?.textColor ?? format?.textColor;
  const bold = conditional?.bold || format?.bold;
  // A stored value that does not fit the column type is kept and flagged.
  const misfit = !cellFitsType(column.type, raw);
  const booleanCol = column.type === "boolean" && !raw.startsWith("=") && !misfit;
  const selectCol = column.type === "select" && !raw.startsWith("=");
  const spanWidth = displayMerge
    ? columns.slice(displayMerge.startCol, displayMerge.startCol + displayMerge.colSpan).reduce((sum, item) => sum + colWidth(item), 0)
    : colWidth(column);
  const spanHeight = displayMerge ? CELL_H * displayMerge.rowSpan : CELL_H;
  const align = format?.align ?? (result.type === "number" ? "right" : "left");
  const multiCell = range.anchor.col !== range.focus.col || range.anchor.row !== range.focus.row;
  const mergeFullySelected = Boolean(displayMerge && isExactMergeSelection(range, displayMerge));

  return (
    <View
      key={column.id}
      style={[
        { width: spanWidth, height: CELL_H },
        displayMerge && displayMerge.rowSpan > 1 ? { zIndex: 8, overflow: "visible" } : null,
      ]}
    >
    <Pressable
      onPressIn={(event) => onCellPressIn(colIndex, rowIndex, event)}
      onLongPress={() => onCellLongPress(colIndex, rowIndex)}
      delayLongPress={450}
      onPress={() => (booleanCol ? toggleBoolean(address) : selectCol ? tapSelectCell(address) : tapCell(address))}
      style={[
        styles.cell,
        displayMerge && displayMerge.rowSpan > 1
          ? { position: "absolute", top: 0, left: 0, width: spanWidth, height: spanHeight, zIndex: 8 }
          : { width: spanWidth },
        fillColor ? { backgroundColor: fillColor } : null,
        inRange && !fillColor && styles.rangeCell,
        isSelected && !multiCell && styles.selectedCell,
        mergeFullySelected && styles.rangeCell,
        inFormulaRange && styles.formulaCell,
        result.type === "error" && styles.errorCell,
      ]}
    >
      {isEditing && editSource === "cell" ? (
        <TextInput
          ref={cellInputRef}
          autoFocus
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          keyboardType={column.type === "number" ? "decimal-pad" : "default"}
          style={styles.cellInput}
        />
      ) : selectCol && display ? (
        <View style={styles.selectChip}>
          <Text numberOfLines={1} style={styles.selectChipText}>{display}</Text>
          <Text style={styles.selectChevron}>▾</Text>
        </View>
      ) : booleanCol ? (
        <Text style={[styles.cellText, styles.boolText]}>
          {display.trim().toUpperCase() === "TRUE" ? "☑" : "☐"}
        </Text>
      ) : (
        <Text
          numberOfLines={format?.wrap ? 4 : 1}
          style={[
            styles.cellText,
            result.type === "number" && styles.numText,
            result.type === "error" && { color: colors.destructive },
            bold && { fontWeight: "600" },
            format?.italic && { fontStyle: "italic" },
            (format?.underline || format?.strikethrough) && {
              textDecorationLine: format.underline && format.strikethrough
                ? "underline line-through"
                : format.underline
                  ? "underline"
                  : "line-through",
            },
            textColor ? { color: textColor } : null,
            format?.fontSize ? { fontSize: format.fontSize } : null,
            format?.fontFamily === "mono" ? { fontFamily: "monospace" } : null,
            format?.fontFamily === "serif" ? { fontFamily: "serif" } : null,
            { textAlign: align },
          ]}
        >
          {display}
        </Text>
      )}
      {misfit && !(isEditing && editSource === "cell") ? (
        <View
          pointerEvents="none"
          accessibilityLabel={`Does not fit the ${column.type} column`}
          style={styles.misfitMark}
        />
      ) : null}
    </Pressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: KINETIC.base },
  toolbar: {
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: KINETIC.border,
    backgroundColor: KINETIC.surface,
  },
  formulaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  filterInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  filterCount: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  fitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.warning,
  },
  fitAddr: { color: colors.warning, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  fitText: { flex: 1, color: colors.warning, fontSize: 12 },
  fitClose: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  fitCloseText: { color: colors.mutedForeground, fontSize: 18 },
  tableTool: {
    flex: 1,
    minWidth: 58,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: KINETIC.card,
  },
  tableCaption: { color: KINETIC.secondary, fontSize: 9, fontWeight: "600", marginTop: 2 },
  toolOn: { backgroundColor: KINETIC.accent },
  addr: {
    minWidth: 42,
    borderRadius: 6,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 5,
    textAlign: "center",
    color: KINETIC.text,
    backgroundColor: KINETIC.accent,
    fontSize: 10,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  fx: { color: KINETIC.secondary, fontSize: 12, fontStyle: "italic", fontWeight: "600" },
  formula: {
    flex: 1,
    minHeight: 30,
    color: KINETIC.text,
    paddingHorizontal: 4,
    fontSize: 12,
    fontFamily: "monospace",
  },
  formulaAction: { width: 44, height: 44, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: KINETIC.card },
  formulaActionOn: { backgroundColor: KINETIC.accent },
  gridViewport: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: KINETIC.base,
  },
  tr: { flexDirection: "row", overflow: "visible" },
  mergeOriginRow: { zIndex: 8, overflow: "visible" },
  mergeSpacer: { height: CELL_H },
  // Pinned layers sit over the scrolled body: the frozen column under the
  // frozen rows, and their shared corner on top of both.
  // zIndex 0 keeps the body's own stacking (merged cells, the fill handle)
  // under the pinned layers on web too.
  bodyLayer: { zIndex: 0 },
  pinLayer: { position: "absolute", top: 0, left: 0 },
  pinLeft: { zIndex: 10 },
  pinTop: { zIndex: 20 },
  pinCorner: { zIndex: 30 },
  // Same freeze line as the desktop grid.
  freezeEdgeCol: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "rgba(124,102,220,0.6)" },
  freezeEdgeRow: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: "rgba(124,102,220,0.6)" },
  selectionOverlay: {
    position: "absolute",
    borderWidth: 2,
    borderColor: KINETIC.accentHover,
    backgroundColor: "transparent",
    zIndex: 6,
  },
  rowHead: {
    width: ROW_HEAD,
    height: CELL_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KINETIC.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: KINETIC.border,
  },
  headCell: {
    height: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    backgroundColor: KINETIC.surface,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: KINETIC.border,
  },
  selectedHead: { backgroundColor: KINETIC.card },
  formulaHead: { borderColor: KINETIC.accentHover },
  // Solid tints (the accent at 12% over the base) so cells scrolling under a
  // pinned one never show through it.
  rangeCell: { backgroundColor: "#1C1B2F" },
  formulaCell: { borderWidth: 1, borderStyle: "dashed", borderColor: KINETIC.accentHover },
  fillHandle: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: KINETIC.accentHover,
    zIndex: 20,
  },
  letter: { color: KINETIC.muted, fontSize: 9, fontVariant: ["tabular-nums"] },
  headNameHit: { flex: 1, minWidth: 0 },
  headName: { color: KINETIC.text, fontSize: 12, fontWeight: "600" },
  rename: {
    flex: 1,
    color: KINETIC.text,
    fontSize: 12,
    padding: 0,
  },
  typeBadge: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  typeText: { color: colors.mutedForeground, fontSize: 9, fontWeight: "600" },
  rowNum: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  cell: {
    height: CELL_H,
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: KINETIC.base,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: KINETIC.border,
  },
  selectedCell: { borderWidth: 2, borderColor: KINETIC.accentHover, backgroundColor: "#251F3E" },
  errorCell: { backgroundColor: "#231A1E" },
  // A corner tick, like a spreadsheet's note marker.
  misfitMark: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderLeftWidth: 7,
    borderTopColor: colors.warning,
    borderLeftColor: "transparent",
  },
  cellText: { color: KINETIC.text, fontSize: 12 },
  numText: { textAlign: "right", fontVariant: ["tabular-nums"] },
  boolText: { textAlign: "center", fontSize: 16 },
  selectChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: KINETIC.border,
    backgroundColor: KINETIC.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  selectChipText: { color: KINETIC.text, fontSize: 12, flexShrink: 1 },
  selectChevron: { color: KINETIC.secondary, fontSize: 10 },
  optionsInput: {
    minHeight: 120,
    maxHeight: 220,
    color: colors.foreground,
    fontSize: 14,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: KINETIC.border,
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  optionsHint: { color: colors.mutedForeground, fontSize: 12, marginHorizontal: 16, marginBottom: 8 },
  cellInput: { color: colors.foreground, fontSize: 13, padding: 0 },
  drawer: { flexShrink: 0, height: 248, backgroundColor: KINETIC.surface, borderTopWidth: 1, borderTopColor: KINETIC.divider },
  drawerCollapsed: { height: 58 },
  drawerHandleHit: { height: 18, alignItems: "center", justifyContent: "center" },
  drawerHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: KINETIC.muted },
  drawerTabsScroll: { flexGrow: 0, flexShrink: 0, height: 40 },
  drawerTabs: { minWidth: "100%", height: 40, flexGrow: 0, alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: KINETIC.border },
  drawerTab: { height: 40, paddingHorizontal: 14, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  drawerTabOn: { borderBottomColor: KINETIC.accentHover },
  drawerTabText: { color: KINETIC.secondary, fontSize: 10, fontWeight: "600" },
  drawerTabTextOn: { color: KINETIC.text },
  drawerBody: { flex: 1 },
  drawerContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 8, flexGrow: 0 },
  sectionLabel: { color: KINETIC.muted, fontSize: 9, fontWeight: "600", letterSpacing: 0.8 },
  actionStrip: { flexDirection: "row", gap: 7 },
  controlRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  wideControl: { flex: 1, height: 40, borderRadius: 7, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  stepControl: { width: 40, height: 40, borderRadius: 7, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card, alignItems: "center", justifyContent: "center" },
  sizeReadout: { width: 38, height: 34, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderBottomWidth: 1, borderColor: KINETIC.border },
  controlOn: { borderColor: KINETIC.accentHover, backgroundColor: "#2A2445" },
  controlText: { color: KINETIC.text, fontSize: 11, fontFamily: "monospace" },
  freezeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  freezeLabel: { width: 60, color: KINETIC.secondary, fontSize: 11 },
  freezeChip: { flex: 1, height: 40, borderRadius: 7, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  freezeNote: { color: KINETIC.secondary, fontSize: 11, lineHeight: 15 },
  functionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  functionButton: { width: "31%", minHeight: 40, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card },
  functionText: { color: KINETIC.text, fontSize: 10, fontWeight: "600", fontFamily: "monospace" },
}));
