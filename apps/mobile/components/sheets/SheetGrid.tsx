import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Eraser, Minus, Plus, Trash2 } from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { colors } from "../../lib/theme";
import { columnIndexToLetter, createSheetEvaluator } from "../../lib/sheetFormula";
import {
  emptySheetRow,
  newSheetId,
  SHEET_COLUMN_TYPES,
  isFormulaValue,
  normalizeTypedCell,
} from "../../lib/sheet";
import type { SheetColumn, SheetColumnType, SheetRow } from "../../lib/types";

const MIN_WIDTH = 88;
const MAX_WIDTH = 240;
const ROW_HEAD = 40;

type Address = { col: number; row: number };

export type SheetGridProps = {
  columns: SheetColumn[];
  rows: SheetRow[];
  onChange: (next: { columns?: SheetColumn[]; rows?: SheetRow[] }) => void;
};

export default function SheetGrid({ columns, rows, onChange }: SheetGridProps) {
  const [selected, setSelected] = useState<Address>({ col: 0, row: 0 });
  const [editing, setEditing] = useState<Address | null>(null);
  const [editSource, setEditSource] = useState<"formula" | "cell" | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [columnMenu, setColumnMenu] = useState<number | null>(null);
  const [typeMenu, setTypeMenu] = useState<number | null>(null);

  const evaluator = useMemo(() => createSheetEvaluator(columns, rows), [columns, rows]);

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
    onChange({
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
    onChange({
      columns: nextColumns,
      rows: rows.map((row) => ({ ...row, cells: { ...row.cells, [column.id]: "" } })),
    });
  }

  function deleteColumn(index: number) {
    if (columns.length <= 1) return;
    const removed = columns[index];
    onChange({
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
    onChange({ rows: next });
  }

  function deleteRow(index: number) {
    if (rows.length <= 1) return;
    onChange({ rows: rows.filter((_, i) => i !== index) });
    setSelected((prev) => ({
      col: prev.col,
      row: Math.max(0, Math.min(prev.row, rows.length - 2)),
    }));
  }

  function renameColumn(index: number, name: string) {
    onChange({
      columns: columns.map((column, i) =>
        i === index ? { ...column, name: name.trim() || columnIndexToLetter(i) } : column,
      ),
    });
  }

  function setColumnType(index: number, type: SheetColumnType) {
    onChange({
      columns: columns.map((column, i) => (i === index ? { ...column, type } : column)),
    });
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
                  const isSelected = selected.col === colIndex && selected.row === rowIndex;
                  const isEditing = editing?.col === colIndex && editing?.row === rowIndex;
                  const result = evaluator.valueAt(colIndex, rowIndex);
                  const display = evaluator.displayAt(colIndex, rowIndex);
                  const booleanCol = column.type === "boolean" && !rawAt(address).startsWith("=");

                  return (
                    <Pressable
                      key={column.id}
                      onPress={() => (booleanCol ? toggleBoolean(address) : tapCell(address))}
                      style={[
                        styles.cell,
                        { width: colWidth(column) },
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
                          numberOfLines={1}
                          style={[
                            styles.cellText,
                            result.type === "number" && styles.numText,
                            result.type === "error" && { color: colors.destructive },
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
    </View>
  );
}

const styles = StyleSheet.create({
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
});
