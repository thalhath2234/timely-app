import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
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
  Trash2,
  Underline,
  Undo2,
} from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { columnIndexToLetter, createSheetEvaluator } from "../../lib/sheetFormula";
import {
  emptySheetRow,
  formatCellDisplay,
  newSheetId,
  SHEET_COLUMN_TYPES,
  isFormulaValue,
  normalizeTypedCell,
} from "../../lib/sheet";
import type { SheetCellFormat, SheetColumn, SheetColumnType, SheetMerge, SheetRow } from "../../lib/types";

const MIN_WIDTH = 88;
const MAX_WIDTH = 240;
const ROW_HEAD = 44;
const CELL_H = 40;
const HEADER_H = 40;
const GHOST_COL_W = 112;
const FILL_SWATCHES = ["#3A3558", "#8B7CF7", "#3E63DD", "#12A594", "#E8B54A", "#EF6B5C", "#E93D82"];

type Address = { col: number; row: number };
type GridSnapshot = { columns: SheetColumn[]; rows: SheetRow[]; merges: SheetMerge[] };

export type SheetGridProps = {
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
  onChange: (next: { columns?: SheetColumn[]; rows?: SheetRow[]; merges?: SheetMerge[] }) => void;
};

export default function SheetGrid({ columns, rows, merges = [], onChange }: SheetGridProps) {
  const [selected, setSelected] = useState<Address>({ col: 0, row: 0 });
  const [editing, setEditing] = useState<Address | null>(null);
  const [editSource, setEditSource] = useState<"formula" | "cell" | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [columnMenu, setColumnMenu] = useState<number | null>(null);
  const [typeMenu, setTypeMenu] = useState<number | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [past, setPast] = useState<GridSnapshot[]>([]);
  const [future, setFuture] = useState<GridSnapshot[]>([]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  function onGridLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width === viewport.width && next.height === viewport.height) return;
    if (next.width > 0 && next.height > 0) setViewport(next);
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
    setSelected((prev) => ({
      col: Math.max(0, Math.min(prev.col, columns.length - 2)),
      row: prev.row,
    }));
  }

  function addRow(atIndex = rows.length) {
    const next = [...rows];
    next.splice(atIndex, 0, emptySheetRow(columns));
    commit({ rows: next });
  }

  function deleteRow(index: number) {
    if (rows.length <= 1) return;
    commit({ rows: rows.filter((_, i) => i !== index) });
    setSelected((prev) => ({
      col: prev.col,
      row: Math.max(0, Math.min(prev.row, rows.length - 2)),
    }));
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

  function renameColumn(index: number, name: string) {
    commit({
      columns: columns.map((column, i) =>
        i === index ? { ...column, name: name.trim() || columnIndexToLetter(i) } : column,
      ),
    });
  }

  function setColumnType(index: number, type: SheetColumnType) {
    commit({
      columns: columns.map((column, i) => (i === index ? { ...column, type } : column)),
    });
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
    setSelected(address);
    setDraft(initial ?? rawAt(address));
    setEditing(address);
    setEditSource(source);
  }

  function commitEdit() {
    if (!editing) return;
    setCellValue(editing, draft);
    setEditing(null);
    setEditSource(null);
    setDraft("");
  }

  function tapCell(address: Address) {
    if (editing) commitEdit();
    if (address.col >= columns.length || address.row >= rows.length) {
      materialize(address);
      setSelected(address);
      return;
    }
    const same = selected.col === address.col && selected.row === address.row;
    if (same) startEditing(address, "cell");
    else setSelected(address);
  }

  function toggleBoolean(address: Address) {
    const current = rawAt(address).trim().toUpperCase();
    const next = current === "TRUE" || current === "1" || current === "YES" ? "FALSE" : "TRUE";
    setCellValue(address, next);
    setSelected(address);
  }

  function formatAt(address: Address): SheetCellFormat | undefined {
    const column = columns[address.col];
    const row = rows[address.row];
    if (!column || !row) return undefined;
    return row.formats?.[column.id];
  }

  function applyFormat(patch: Partial<SheetCellFormat> | null) {
    const column = columns[selected.col];
    const row = rows[selected.row];
    if (!column || !row) return;
    const current = { ...(row.formats?.[column.id] ?? {}) };
    const nextFormat = patch == null ? undefined : { ...current, ...patch };
    if (nextFormat) {
      for (const [key, value] of Object.entries(nextFormat)) {
        if (value == null || value === false) delete nextFormat[key as keyof SheetCellFormat];
      }
    }
    commit({
      rows: rows.map((item, index) => {
        if (index !== selected.row) return item;
        const formats = { ...(item.formats ?? {}) };
        if (!nextFormat || Object.keys(nextFormat).length === 0) delete formats[column.id];
        else formats[column.id] = nextFormat;
        return { ...item, formats };
      }),
    });
  }

  function mergeRight() {
    const startCol = selected.col;
    const startRow = selected.row;
    if (startCol >= columns.length - 1) return;
    const filtered = merges.filter(
      (merge) =>
        !(
          startCol >= merge.startCol &&
          startCol < merge.startCol + merge.colSpan &&
          startRow >= merge.startRow &&
          startRow < merge.startRow + merge.rowSpan
        ),
    );
    commit({
      merges: [...filtered, { startCol, startRow, colSpan: 2, rowSpan: 1 }],
    });
  }

  const selectedFormat = formatAt(selected);
  const selectedRaw = rawAt(selected);
  const selectedAddress = columns.length && rows.length
    ? `${columnIndexToLetter(selected.col)}${selected.row + 1}`
    : "—";

  const displayCols = columns.length + ghostColCount;
  const ghostRowIndexes = Array.from({ length: ghostRowCount }, (_, i) => rows.length + i);

  return (
    <View style={styles.root} collapsable={false}>
      <View style={styles.toolbar}>
        <View style={styles.formulaRow}>
          <Text style={styles.addr}>{selectedAddress}</Text>
          <TextInput
            value={editing ? draft : selectedRaw}
            onFocus={() => {
              if (!editing) startEditing(selected, "formula");
              else setEditSource("formula");
            }}
            onChangeText={(value) => {
              if (!editing) startEditing(selected, "formula", value);
              else setDraft(value);
            }}
            onSubmitEditing={commitEdit}
            onBlur={() => {
              if (editing && editSource === "formula") commitEdit();
            }}
            placeholder="Value or =SUM(A1:A5)"
            placeholderTextColor={colors.mutedForeground}
            style={styles.formula}
          />
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
        <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.tableBar}>
          <Tool icon={<Undo2 size={16} color={colors.foreground} />} caption="Undo" disabled={past.length === 0} onPress={undo} />
          <Tool icon={<Redo2 size={16} color={colors.foreground} />} caption="Redo" disabled={future.length === 0} onPress={redo} />
          <Tool
            icon={<Filter size={16} color={showFilter ? colors.accentForeground : colors.foreground} />}
            caption="Filter"
            active={showFilter}
            onPress={() => setFilterOpen((open) => !open)}
          />
          <Tool
            icon={<Bold size={16} color={selectedFormat?.bold ? colors.accentForeground : colors.foreground} />}
            caption="B"
            active={Boolean(selectedFormat?.bold)}
            onPress={() => applyFormat({ bold: !selectedFormat?.bold })}
          />
          <Tool
            icon={<Italic size={16} color={selectedFormat?.italic ? colors.accentForeground : colors.foreground} />}
            caption="I"
            active={Boolean(selectedFormat?.italic)}
            onPress={() => applyFormat({ italic: !selectedFormat?.italic })}
          />
          <Tool
            icon={<Underline size={16} color={selectedFormat?.underline ? colors.accentForeground : colors.foreground} />}
            caption="U"
            active={Boolean(selectedFormat?.underline)}
            onPress={() => applyFormat({ underline: !selectedFormat?.underline })}
          />
          <Tool icon={<AlignLeft size={16} color={colors.foreground} />} onPress={() => applyFormat({ align: "left" })} active={selectedFormat?.align === "left"} />
          <Tool icon={<AlignCenter size={16} color={colors.foreground} />} onPress={() => applyFormat({ align: "center" })} active={selectedFormat?.align === "center"} />
          <Tool icon={<AlignRight size={16} color={colors.foreground} />} onPress={() => applyFormat({ align: "right" })} active={selectedFormat?.align === "right"} />
          <Tool icon={<Hash size={16} color={colors.foreground} />} caption="123" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "number" ? undefined : "number" })} active={selectedFormat?.numberFormat === "number"} />
          <Tool icon={<DollarSign size={16} color={colors.foreground} />} caption="$" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "currency" ? undefined : "currency" })} active={selectedFormat?.numberFormat === "currency"} />
          <Tool icon={<Percent size={16} color={colors.foreground} />} caption="%" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "percent" ? undefined : "percent" })} active={selectedFormat?.numberFormat === "percent"} />
          <Tool icon={<PaintBucket size={16} color={selectedFormat?.fillColor || colors.foreground} />} caption="Fill" onPress={() => setFillOpen(true)} />
          <Tool icon={<Combine size={16} color={colors.foreground} />} caption="Merge" onPress={mergeRight} />
          <Tool icon={<Plus size={16} color={colors.foreground} />} caption="Col" onPress={() => addColumn(selected.col + 1)} />
          <Tool icon={<Minus size={16} color={colors.destructive} />} caption="Col" disabled={columns.length <= 1} onPress={() => deleteColumn(selected.col)} />
          <Tool icon={<Plus size={16} color={colors.foreground} />} caption="Row" onPress={() => addRow(selected.row + 1)} />
          <Tool icon={<Minus size={16} color={colors.destructive} />} caption="Row" disabled={rows.length <= 1} onPress={() => deleteRow(selected.row)} />
          <Tool icon={<Eraser size={16} color={colors.foreground} />} caption="Clear" onPress={() => setCellValue(selected, "")} />
        </ScrollView>
      </View>

      <View style={styles.gridViewport} onLayout={onGridLayout} collapsable={false}>
        {viewport.width > 0 && viewport.height > 0 ? (
          <ScrollView
            style={{ width: viewport.width, height: viewport.height }}
            contentContainerStyle={{ minHeight: viewport.height }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            removeClippedSubviews={false}
            bounces={false}
          >
            <ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="always"
              removeClippedSubviews={false}
              bounces={false}
            >
              <View collapsable={false}>
                <View style={styles.tr} collapsable={false}>
                  <View style={[styles.rowHead, styles.headCell]} />
                  {Array.from({ length: displayCols }, (_, index) => {
                    const column = columns[index];
                    const width = column ? colWidth(column) : GHOST_COL_W;
                    return (
                      <Pressable
                        key={column?.id ?? `ghost-col-${index}`}
                        onPress={() => {
                          if (column) setSelected({ col: index, row: selected.row });
                          else {
                            materialize({ col: index, row: Math.max(0, selected.row) });
                            setSelected({ col: index, row: Math.max(0, selected.row) });
                          }
                        }}
                        onLongPress={() => {
                          if (column) setColumnMenu(index);
                        }}
                        style={[
                          styles.headCell,
                          { width },
                          index === selected.col && styles.selectedHead,
                        ]}
                      >
                        <Text style={styles.letter}>{columnIndexToLetter(index)}</Text>
                        {column && renaming === index ? (
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
                          <Pressable
                            onPress={() => {
                              setRenameDraft(column.name);
                              setRenaming(index);
                            }}
                            style={styles.headNameHit}
                          >
                            <Text numberOfLines={1} style={styles.headName}>{column.name}</Text>
                          </Pressable>
                        ) : null}
                        {column ? (
                          <Pressable onPress={() => setTypeMenu(index)} style={styles.typeBadge}>
                            <Text style={styles.typeText}>{column.type[0]?.toUpperCase()}</Text>
                          </Pressable>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>

                {visibleRowIndexes.map((rowIndex) => {
                  const row = rows[rowIndex];
                  if (!row) return null;
                  return (
                    <View key={row.id} style={styles.tr} collapsable={false}>
                      <View style={[styles.rowHead, rowIndex === selected.row && styles.selectedHead]}>
                        <Text style={styles.rowNum}>{rowIndex + 1}</Text>
                      </View>
                      {Array.from({ length: displayCols }, (_, colIndex) =>
                        renderCell({
                          colIndex,
                          rowIndex,
                          row,
                          selected,
                          editing,
                          editSource,
                          draft,
                          setDraft,
                          commitEdit,
                          tapCell,
                          toggleBoolean,
                          evaluator,
                          columns,
                          merges,
                          colWidth,
                          rawAt,
                        }),
                      )}
                    </View>
                  );
                })}

                {ghostRowIndexes.map((rowIndex) => (
                  <View key={`ghost-row-${rowIndex}`} style={styles.tr} collapsable={false}>
                    <Pressable
                      onPress={() => {
                        materialize({ col: Math.max(0, selected.col), row: rowIndex });
                        setSelected({ col: Math.max(0, selected.col), row: rowIndex });
                      }}
                      style={styles.rowHead}
                    >
                      <Text style={styles.rowNum}>{rowIndex + 1}</Text>
                    </Pressable>
                    {Array.from({ length: displayCols }, (_, colIndex) => (
                      <Pressable
                        key={`ghost-${rowIndex}-${colIndex}`}
                        onPress={() => tapCell({ col: colIndex, row: rowIndex })}
                        style={[
                          styles.cell,
                          { width: columns[colIndex] ? colWidth(columns[colIndex]) : GHOST_COL_W },
                          selected.col === colIndex && selected.row === rowIndex && styles.selectedCell,
                        ]}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
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
  editing,
  editSource,
  draft,
  setDraft,
  commitEdit,
  tapCell,
  toggleBoolean,
  evaluator,
  columns,
  merges,
  colWidth,
  rawAt,
}: {
  colIndex: number;
  rowIndex: number;
  row: SheetRow;
  selected: Address;
  editing: Address | null;
  editSource: "formula" | "cell" | null;
  draft: string;
  setDraft: (value: string) => void;
  commitEdit: () => void;
  tapCell: (address: Address) => void;
  toggleBoolean: (address: Address) => void;
  evaluator: ReturnType<typeof createSheetEvaluator>;
  columns: SheetColumn[];
  merges: SheetMerge[];
  colWidth: (column: SheetColumn) => number;
  rawAt: (address: Address) => string;
}) {
  const column = columns[colIndex];
  const address = { col: colIndex, row: rowIndex };
  if (!column) {
    return (
      <Pressable
        key={`ghost-cell-${rowIndex}-${colIndex}`}
        onPress={() => tapCell(address)}
        style={[
          styles.cell,
          { width: GHOST_COL_W },
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
  if (merge && (merge.startCol !== colIndex || merge.startRow !== rowIndex)) return null;
  const isSelected = selected.col === colIndex && selected.row === rowIndex;
  const isEditing = editing?.col === colIndex && editing?.row === rowIndex;
  const result = evaluator.valueAt(colIndex, rowIndex);
  const format = row.formats?.[column.id];
  const display = formatCellDisplay(evaluator.displayAt(colIndex, rowIndex), format, column.type);
  const booleanCol = column.type === "boolean" && !rawAt(address).startsWith("=");
  const spanWidth = merge
    ? columns.slice(merge.startCol, merge.startCol + merge.colSpan).reduce((sum, item) => sum + colWidth(item), 0)
    : colWidth(column);
  const align = format?.align ?? (result.type === "number" ? "right" : "left");

  return (
    <Pressable
      key={column.id}
      onPress={() => (booleanCol ? toggleBoolean(address) : tapCell(address))}
      style={[
        styles.cell,
        { width: spanWidth },
        format?.fillColor ? { backgroundColor: format.fillColor } : null,
        isSelected && styles.selectedCell,
        result.type === "error" && styles.errorCell,
      ]}
    >
      {isEditing && editSource === "cell" ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          keyboardType={column.type === "number" ? "decimal-pad" : "default"}
          style={styles.cellInput}
        />
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
            format?.underline && { textDecorationLine: "underline" },
            format?.strikethrough && { textDecorationLine: "line-through" },
            format?.textColor ? { color: format.textColor } : null,
            { textAlign: align },
          ]}
        >
          {display}
        </Text>
      )}
    </Pressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { flex: 1, minHeight: 0 },
  toolbar: {
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  formulaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 6,
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
  tableBar: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableTool: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: colors.popover,
  },
  tableCaption: { color: colors.mutedForeground, fontSize: 10, fontWeight: "600" },
  toolOn: { backgroundColor: colors.accent },
  addr: {
    width: 40,
    textAlign: "center",
    color: colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  formula: {
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
  gridViewport: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  tr: { flexDirection: "row" },
  rowHead: {
    width: ROW_HEAD,
    height: CELL_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headCell: {
    height: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    backgroundColor: colors.muted,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  selectedHead: { backgroundColor: colors.accent },
  letter: { color: colors.mutedForeground, fontSize: 10, fontVariant: ["tabular-nums"] },
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
    backgroundColor: colors.card,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  selectedCell: { borderWidth: 2, borderColor: colors.ring, zIndex: 1, margin: -1 },
  errorCell: { backgroundColor: "rgba(239,107,92,0.08)" },
  cellText: { color: colors.foreground, fontSize: 13 },
  numText: { textAlign: "right", fontVariant: ["tabular-nums"] },
  boolText: { textAlign: "center", fontSize: 16 },
  cellInput: { color: colors.foreground, fontSize: 13, padding: 0 },
}));
