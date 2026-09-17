import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Combine,
  DollarSign,
  Eraser,
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
const ROW_HEAD = 40;
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
  const [past, setPast] = useState<GridSnapshot[]>([]);
  const [future, setFuture] = useState<GridSnapshot[]>([]);

  const evaluator = useMemo(() => createSheetEvaluator(columns, rows), [columns, rows]);

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

  const colWidth = (column: SheetColumn) =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, column.width || 140));

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

  function addColumn(atIndex = columns.length) {
    const column: SheetColumn = {
      id: newSheetId("col"),
      name: columnIndexToLetter(atIndex),
      width: 140,
      type: "text",
    };
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

  return (
    <View style={styles.root}>
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
        <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.tableBar}>
          <Pressable accessibilityLabel="Undo" disabled={past.length === 0} onPress={undo} style={[styles.tableTool, past.length === 0 && { opacity: 0.35 }]}>
            <Undo2 size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Undo</Text>
          </Pressable>
          <Pressable accessibilityLabel="Redo" disabled={future.length === 0} onPress={redo} style={[styles.tableTool, future.length === 0 && { opacity: 0.35 }]}>
            <Redo2 size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Redo</Text>
          </Pressable>
          <Pressable accessibilityLabel="Bold" onPress={() => applyFormat({ bold: !selectedFormat?.bold })} style={[styles.tableTool, selectedFormat?.bold && styles.toolOn]}>
            <Bold size={16} color={selectedFormat?.bold ? colors.accentForeground : colors.foreground} />
            <Text style={styles.tableCaption}>B</Text>
          </Pressable>
          <Pressable accessibilityLabel="Italic" onPress={() => applyFormat({ italic: !selectedFormat?.italic })} style={[styles.tableTool, selectedFormat?.italic && styles.toolOn]}>
            <Italic size={16} color={selectedFormat?.italic ? colors.accentForeground : colors.foreground} />
            <Text style={styles.tableCaption}>I</Text>
          </Pressable>
          <Pressable accessibilityLabel="Underline" onPress={() => applyFormat({ underline: !selectedFormat?.underline })} style={[styles.tableTool, selectedFormat?.underline && styles.toolOn]}>
            <Underline size={16} color={selectedFormat?.underline ? colors.accentForeground : colors.foreground} />
            <Text style={styles.tableCaption}>U</Text>
          </Pressable>
          <Pressable accessibilityLabel="Align left" onPress={() => applyFormat({ align: "left" })} style={[styles.tableTool, selectedFormat?.align === "left" && styles.toolOn]}>
            <AlignLeft size={16} color={colors.foreground} />
          </Pressable>
          <Pressable accessibilityLabel="Align center" onPress={() => applyFormat({ align: "center" })} style={[styles.tableTool, selectedFormat?.align === "center" && styles.toolOn]}>
            <AlignCenter size={16} color={colors.foreground} />
          </Pressable>
          <Pressable accessibilityLabel="Align right" onPress={() => applyFormat({ align: "right" })} style={[styles.tableTool, selectedFormat?.align === "right" && styles.toolOn]}>
            <AlignRight size={16} color={colors.foreground} />
          </Pressable>
          <Pressable accessibilityLabel="Number" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "number" ? undefined : "number" })} style={[styles.tableTool, selectedFormat?.numberFormat === "number" && styles.toolOn]}>
            <Hash size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>123</Text>
          </Pressable>
          <Pressable accessibilityLabel="Currency" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "currency" ? undefined : "currency" })} style={[styles.tableTool, selectedFormat?.numberFormat === "currency" && styles.toolOn]}>
            <DollarSign size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>$</Text>
          </Pressable>
          <Pressable accessibilityLabel="Percent" onPress={() => applyFormat({ numberFormat: selectedFormat?.numberFormat === "percent" ? undefined : "percent" })} style={[styles.tableTool, selectedFormat?.numberFormat === "percent" && styles.toolOn]}>
            <Percent size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>%</Text>
          </Pressable>
          <Pressable accessibilityLabel="Fill color" onPress={() => setFillOpen(true)} style={styles.tableTool}>
            <PaintBucket size={16} color={selectedFormat?.fillColor || colors.foreground} />
            <Text style={styles.tableCaption}>Fill</Text>
          </Pressable>
          <Pressable accessibilityLabel="Merge right" onPress={mergeRight} style={styles.tableTool}>
            <Combine size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Merge</Text>
          </Pressable>
        </ScrollView>
        <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.tableBar}>
          <Pressable accessibilityLabel="Add column before" onPress={() => addColumn(selected.col)} style={styles.tableTool}>
            <Plus size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>⟨Col</Text>
          </Pressable>
          <Pressable accessibilityLabel="Add column after" onPress={() => addColumn(selected.col + 1)} style={styles.tableTool}>
            <Plus size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Col⟩</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Delete column"
            onPress={() => deleteColumn(selected.col)}
            disabled={columns.length <= 1}
            style={[styles.tableTool, columns.length <= 1 && { opacity: 0.35 }]}
          >
            <Minus size={16} color={colors.destructive} />
            <Text style={[styles.tableCaption, { color: colors.destructive }]}>−Col</Text>
          </Pressable>
          <Pressable accessibilityLabel="Add row before" onPress={() => addRow(selected.row)} style={styles.tableTool}>
            <Plus size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>⟨Row</Text>
          </Pressable>
          <Pressable accessibilityLabel="Add row after" onPress={() => addRow(selected.row + 1)} style={styles.tableTool}>
            <Plus size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Row⟩</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Delete row"
            onPress={() => deleteRow(selected.row)}
            disabled={rows.length <= 1}
            style={[styles.tableTool, rows.length <= 1 && { opacity: 0.35 }]}
          >
            <Minus size={16} color={colors.destructive} />
            <Text style={[styles.tableCaption, { color: colors.destructive }]}>−Row</Text>
          </Pressable>
          <Pressable accessibilityLabel="Clear cell" onPress={() => setCellValue(selected, "")} style={styles.tableTool}>
            <Eraser size={16} color={colors.foreground} />
            <Text style={styles.tableCaption}>Clear</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <View>
            <View style={styles.tr}>
              <View style={[styles.rowHead, styles.headCell]} />
              {columns.map((column, index) => (
                <Pressable
                  key={column.id}
                  onPress={() => setSelected({ col: index, row: selected.row })}
                  onLongPress={() => setColumnMenu(index)}
                  style={[
                    styles.headCell,
                    { width: colWidth(column) },
                    index === selected.col && styles.selectedHead,
                  ]}
                >
                  <Text style={styles.letter}>{columnIndexToLetter(index)}</Text>
                  {renaming === index ? (
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
                  ) : (
                    <Pressable
                      onPress={() => {
                        setRenameDraft(column.name);
                        setRenaming(index);
                      }}
                      style={{ flex: 1 }}
                    >
                      <Text numberOfLines={1} style={styles.headName}>{column.name}</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => setTypeMenu(index)} style={styles.typeBadge}>
                    <Text style={styles.typeText}>{column.type[0]?.toUpperCase()}</Text>
                  </Pressable>
                </Pressable>
              ))}
              <Pressable accessibilityLabel="Add column" onPress={() => addColumn()} style={styles.addCol}>
                <Plus size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {rows.map((row, rowIndex) => (
              <View key={row.id} style={styles.tr}>
                <View style={[styles.rowHead, rowIndex === selected.row && styles.selectedHead]}>
                  <Text style={styles.rowNum}>{rowIndex + 1}</Text>
                </View>
                {columns.map((column, colIndex) => {
                  const address = { col: colIndex, row: rowIndex };
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
                    ? columns
                        .slice(merge.startCol, merge.startCol + merge.colSpan)
                        .reduce((sum, item) => sum + colWidth(item), 0)
                    : colWidth(column);
                  const align = format?.align ?? (result.type === "number" ? "right" : "left");

                  return (
                    <Pressable
                      key={column.id}
                      onPress={() => (booleanCol ? toggleBoolean(address) : tapCell(address))}
                      style={[
                        styles.cell,
                        { width: spanWidth, backgroundColor: format?.fillColor || colors.card },
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
                })}
                <View style={styles.addCol} />
              </View>
            ))}

            <View style={styles.tr}>
              <Pressable accessibilityLabel="Add row" onPress={() => addRow()} style={[styles.rowHead, styles.addRow]}>
                <Plus size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </ScrollView>

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

const styles = createThemedStyleSheet((colors) => ({
  root: { flex: 1, minHeight: 280 },
  toolbar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  tableBar: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableTool: {
    minWidth: 48,
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
  tr: { flexDirection: "row" },
  rowHead: {
    width: ROW_HEAD,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headCell: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    backgroundColor: colors.muted,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  selectedHead: { backgroundColor: colors.accent },
  letter: { color: colors.mutedForeground, fontSize: 10, fontVariant: ["tabular-nums"] },
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
  addCol: {
    width: 40,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  addRow: { minHeight: 36 },
  rowNum: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  cell: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: colors.card,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  selectedCell: { borderWidth: 2, borderColor: colors.ring, paddingHorizontal: 6 },
  errorCell: { backgroundColor: "rgba(239,107,92,0.08)" },
  cellText: { color: colors.foreground, fontSize: 13 },
  numText: { textAlign: "right", fontVariant: ["tabular-nums"] },
  boolText: { textAlign: "center", fontSize: 16 },
  cellInput: { color: colors.foreground, fontSize: 13, padding: 0 },
}));
