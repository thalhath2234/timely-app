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
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Ungroup,
  WrapText,
} from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { columnIndexToLetter, createSheetEvaluator, shiftFormula } from "../../lib/sheetFormula";
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
} from "../../lib/sheetRange";
import {
  SHEET_COLUMN_TYPES,
  columnTypeBadge,
  emptySheetRow,
  formatCellDisplay,
  isFormulaValue,
  newSheetId,
  normalizeTypedCell,
  parseSelectOptions,
  syncSelectOptions,
} from "../../lib/sheet";
import type { SheetCellFormat, SheetColumn, SheetColumnType, SheetMerge, SheetRow } from "../../lib/types";

const MIN_WIDTH = 82;
const MAX_WIDTH = 240;
const ROW_HEAD = 38;
const CELL_H = 32;
const HEADER_H = 34;
const GHOST_COL_W = 104;
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
type GridSnapshot = { columns: SheetColumn[]; rows: SheetRow[]; merges: SheetMerge[] };
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
  onAssistantContext?: (value: { selection: string; filter: string; draft: string }) => void;
  onChange: (next: { columns?: SheetColumn[]; rows?: SheetRow[]; merges?: SheetMerge[] }) => void;
};

/** Lets the owning screen finish an in-progress cell edit before it leaves. */
export type SheetGridHandle = {
  /** Commits the active cell draft, if any. Returns whether a draft was committed. */
  commitActiveEdit: () => boolean;
};

export default function SheetGrid({ columns, rows, merges = [], onChange, onAssistantContext, ref }: SheetGridProps & { ref?: Ref<SheetGridHandle> }) {
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
    const colCount = Math.max(columns.length, grown?.cols ?? 0, 1);
    const rowCount = Math.max(rows.length, grown?.rows ?? 0, 1);
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

  function colFromDelta(originCol: number, locationX: number, dx: number) {
    let x = locationX + dx;
    let col = originCol;
    const maxCol = Math.max(columns.length, 1);
    if (x >= 0) {
      while (col < maxCol) {
        const width = columns[col] ? colWidth(columns[col]) : GHOST_COL_W;
        if (x < width) break;
        x -= width;
        col += 1;
      }
    } else {
      while (col > 0 && x < 0) {
        col -= 1;
        const width = columns[col] ? colWidth(columns[col]) : GHOST_COL_W;
        x += width;
      }
    }
    return Math.max(0, col);
  }

  function addressFromPage(pageX: number, pageY: number): HitZone | null {
    const origin = dragOriginRef.current;
    if (!origin) return null;
    const scale = dragScale(origin.pageX, origin.pageY, pageX, pageY);
    const dx = (pageX - origin.pageX) / scale;
    const dy = (pageY - origin.pageY) / scale;
    const col = colFromDelta(origin.hit.col, origin.locationX, dx);
    const rowStep = origin.hit.zone === "col" ? HEADER_H : CELL_H;
    const row = Math.max(0, origin.hit.row + Math.floor((origin.locationY + dy) / rowStep));
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

  const evaluator = useMemo(() => createSheetEvaluator(columns, rows), [columns, rows]);
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

  const colWidth = (column: SheetColumn) =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, column.width || 140));

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

  const snapshot = (): GridSnapshot => ({ columns, rows, merges });

  function commit(next: { columns?: SheetColumn[]; rows?: SheetRow[]; merges?: SheetMerge[] }) {
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

  function setCellValue(address: Address, value: string) {
    const column = columns[address.col];
    if (!column) return;
    commit({
      rows: rows.map((row, index) =>
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

  function addColumn(atIndex = columns.length) {
    const column = makeColumn(atIndex);
    const nextColumns = [...columns];
    nextColumns.splice(atIndex, 0, column);
    commit({
      columns: nextColumns,
      rows: rows.map((row) => ({ ...row, cells: { ...row.cells, [column.id]: "" } })),
    });
  }

  function deleteColumn(index: number) {
    if (columns.length <= 1) return;
    const removed = columns[index];
    commit({
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
    commit({ rows: next });
  }

  function deleteRow(index: number) {
    if (rows.length <= 1) return;
    commit({ rows: rows.filter((_, i) => i !== index) });
    setSelection({
      col: selected.col,
      row: Math.max(0, Math.min(selected.row, rows.length - 2)),
    });
  }

  function materialize(address: Address) {
    let nextColumns = columns;
    let nextRows = rows;
    if (address.col >= nextColumns.length) {
      const extra: SheetColumn[] = [];
      for (let i = nextColumns.length; i <= address.col; i += 1) extra.push(makeColumn(i));
      nextColumns = [...nextColumns, ...extra];
      nextRows = nextRows.map((row) => {
        const cells = { ...row.cells };
        for (const column of extra) cells[column.id] = "";
        return { ...row, cells };
      });
    }
    if (address.row >= nextRows.length) {
      const extraRows: SheetRow[] = [];
      for (let i = nextRows.length; i <= address.row; i += 1) extraRows.push(emptySheetRow(nextColumns));
      nextRows = [...nextRows, ...extraRows];
    }
    if (nextColumns !== columns || nextRows !== rows) {
      commit({
        columns: nextColumns !== columns ? nextColumns : undefined,
        rows: nextRows !== rows ? nextRows : undefined,
      });
    }
  }

  function selectGrown(address: Address) {
    materialize(address);
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
    setSelection(address);
    setDraft(initial ?? rawAt(address));
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
    const value = isFormulaValue(raw) ? closeOpenParens(raw.trim()) : raw;
    // Blur before the editor unmounts. Android otherwise hands focus to the
    // first TextInput on the screen (the sheet title) when a focused input
    // disappears, so the caret appeared in the title after tapping a cell.
    editingRef.current = null;
    if (cellInputRef.current?.isFocused()) cellInputRef.current.blur();
    setCellValue(address, value);
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
      selectGrown(address);
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
    const nextRows = rows.map((row) => ({
      ...row,
      formats: { ...(row.formats ?? {}) },
    }));
    visitRange(range, (address) => {
      const column = columns[address.col];
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
      rows: nextRows.map((row) => ({
        ...row,
        formats: Object.keys(row.formats).length ? row.formats : undefined,
      })),
    });
  }

  function mergeSelection() {
    const span = normalizedRange(range);
    if (span.minCol === span.maxCol && span.minRow === span.maxRow) {
      if (selected.col >= columns.length - 1) return;
      commit({ merges: mergeAll(merges, { anchor: selected, focus: { col: selected.col + 1, row: selected.row } }) });
      return;
    }
    commit({ merges: mergeAll(merges, range) });
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
  const selectedRaw = rawAt(selected);
  const contextCallback = useRef(onAssistantContext);
  contextCallback.current = onAssistantContext;
  const selectedValues = rows.slice(bounds.minRow, bounds.maxRow + 1).map((row) => ({ id: row.id, cells: Object.fromEntries(columns.slice(bounds.minCol, bounds.maxCol + 1).map((col) => [col.id, row.cells[col.id]])) }));
  const contextSnapshot = JSON.stringify({ range: selectionAddressLabel(range, merges), columns: columns.slice(bounds.minCol, bounds.maxCol + 1), rows: selectedValues, editing: editing ? { address: editing, value: draft } : undefined });
  useEffect(() => { contextCallback.current?.({ selection: contextSnapshot, filter: filterQuery, draft: editing ? draft : "" }); }, [contextSnapshot, filterQuery]);

  const selectedAddress = columns.length && rows.length ? selectionAddressLabel(range, merges) : "—";
  const mergeActive = hasMergeInRange(merges, range);
  const canMerge = bounds.minCol !== bounds.maxCol || bounds.minRow !== bounds.maxRow;
  const formulaEditActive = Boolean(editing && isFormulaValue(draft));

  const displayCols = columns.length + ghostColCount;
  const ghostRowIndexes = Array.from({ length: ghostRowCount }, (_, i) => rows.length + i);

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
          <ScrollView
            style={{ width: viewport.width, height: viewport.height }}
            contentContainerStyle={{ minHeight: viewport.height }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            removeClippedSubviews={false}
            bounces={false}
            scrollEnabled={!gridLocked && !formulaEditActive}
            canCancelContentTouches={!gridLocked && !formulaEditActive}
          >
            <ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="always"
              removeClippedSubviews={false}
              bounces={false}
              scrollEnabled={!gridLocked && !formulaEditActive}
              canCancelContentTouches={!gridLocked && !formulaEditActive}
            >
              <View
                collapsable={false}
                style={{ position: "relative" }}
              >
                <View style={styles.tr} collapsable={false}>
                  <View style={[styles.rowHead, styles.headCell]} />
                  {Array.from({ length: displayCols }, (_, index) => {
                    const column = columns[index];
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
                  })}
                </View>

                {visibleRowIndexes.map((rowIndex) => {
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
                      {Array.from({ length: displayCols }, (_, colIndex) =>
                        renderCell({
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
                        }),
                      )}
                    </View>
                  );
                })}

                {ghostRowIndexes.map((rowIndex) => (
                  <View key={`ghost-row-${rowIndex}`} style={styles.tr} collapsable={false}>
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
                    {Array.from({ length: displayCols }, (_, colIndex) => (
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
                    ))}
                  </View>
                ))}
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
              </View>
            </ScrollView>
          </ScrollView>
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
}) {
  const column = columns[colIndex];
  const address = { col: colIndex, row: rowIndex };
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
  const display = formatCellDisplay(evaluator.displayAt(colIndex, rowIndex), format, column.type);
  const booleanCol = column.type === "boolean" && !rawAt(address).startsWith("=");
  const selectCol = column.type === "select" && !rawAt(address).startsWith("=");
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
        format?.fillColor ? { backgroundColor: format.fillColor } : null,
        inRange && !format?.fillColor && styles.rangeCell,
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
            format?.bold && { fontWeight: "700" },
            format?.italic && { fontStyle: "italic" },
            (format?.underline || format?.strikethrough) && {
              textDecorationLine: format.underline && format.strikethrough
                ? "underline line-through"
                : format.underline
                  ? "underline"
                  : "line-through",
            },
            format?.textColor ? { color: format.textColor } : null,
            format?.fontSize ? { fontSize: format.fontSize } : null,
            format?.fontFamily === "mono" ? { fontFamily: "monospace" } : null,
            format?.fontFamily === "serif" ? { fontFamily: "serif" } : null,
            { textAlign: align },
          ]}
        >
          {display}
        </Text>
      )}
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
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  fx: { color: KINETIC.secondary, fontSize: 12, fontStyle: "italic", fontWeight: "700" },
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
  rangeCell: { backgroundColor: "rgba(110,86,207,0.12)" },
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
  headName: { color: colors.foreground, fontSize: 12, fontWeight: "600" },
  rename: {
    flex: 1,
    color: colors.foreground,
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
  typeText: { color: colors.mutedForeground, fontSize: 9, fontWeight: "700" },
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
  errorCell: { backgroundColor: "rgba(239,107,92,0.08)" },
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
  selectChipText: { color: colors.foreground, fontSize: 12, flexShrink: 1 },
  selectChevron: { color: colors.mutedForeground, fontSize: 10 },
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
  sectionLabel: { color: KINETIC.muted, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  actionStrip: { flexDirection: "row", gap: 7 },
  controlRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  wideControl: { flex: 1, height: 40, borderRadius: 7, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  stepControl: { width: 40, height: 40, borderRadius: 7, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card, alignItems: "center", justifyContent: "center" },
  sizeReadout: { width: 38, height: 34, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderBottomWidth: 1, borderColor: KINETIC.border },
  controlOn: { borderColor: KINETIC.accentHover, backgroundColor: "#2A2445" },
  controlText: { color: KINETIC.text, fontSize: 11, fontFamily: "monospace" },
  functionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  functionButton: { width: "31%", minHeight: 40, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: KINETIC.border, backgroundColor: KINETIC.card },
  functionText: { color: KINETIC.text, fontSize: 10, fontWeight: "700", fontFamily: "monospace" },
}));
