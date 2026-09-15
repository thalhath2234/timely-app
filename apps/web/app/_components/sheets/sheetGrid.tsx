"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Columns3,
  Combine,
  Eraser,
  Filter,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import {
  SheetCellFormat,
  SheetColumn,
  SheetColumnType,
  SheetMerge,
  SheetNumberFormat,
  SheetRow,
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
  SHEET_COLUMN_TYPES,
  toggleNumberFormat,
} from "@/app/utils/sheetColumns";
import {
  columnTypeBadge,
  cycleAlign,
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
  isInRange,
  isMergeOrigin,
  mergeFromRange,
  normalizedRange,
  rangeAddressLabel,
  sameAddress,
  selectionStats,
  toggleMerge,
  visitRange,
} from "@/app/utils/sheetRange";

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 640;
const ROW_HEADER_WIDTH = 52;
const ROW_HEIGHT = 32;

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

export default function SheetGrid({
  columns,
  rows,
  merges = [],
  onChange,
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const selected = range.focus;
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const editSourceRef = useRef<"cell" | "formulaBar">("cell");
  const dragRef = useRef<"select" | "fill" | null>(null);
  const fillOriginRef = useRef<CellRange | null>(null);
  const resizeStateRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const evaluator = useMemo(
    () => createSheetEvaluator(columns, rows),
    [columns, rows],
  );

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

    onChange({
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
    onChange({ rows: nextRows });
  };

  const applyFormat = (patch: Partial<SheetCellFormat>) => {
    patchCells((row, address, column) => ({
      ...row,
      formats: setCellFormat(row.formats, column.id, patch),
    }));
  };

  const setColumnType = (index: number, type: SheetColumnType) => {
    onChange({
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

    onChange({
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
    onChange({
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
    onChange({
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
    onChange({
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
    onChange({
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
    onChange({ rows: sorted, merges: [] });
    setFilterOpen(false);
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

    onChange({
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
    setSelection(address);
    setDraft(initialValue ?? rawAt(address));
    setEditing(address);
  };

  const commitEdit = (move: "down" | "right" | "none" = "none") => {
    if (!editing) return;
    const startedInFormulaBar = editSourceRef.current === "formulaBar";
    setCellValue(editing, draft);
    setEditing(null);
    setDraft("");
    if (move === "down") {
      setSelection({ col: editing.col, row: Math.min(editing.row + 1, rows.length - 1) });
    }
    if (move === "right") {
      setSelection({ col: Math.min(editing.col + 1, columns.length - 1), row: editing.row });
    }
    if (!startedInFormulaBar || move !== "none") gridRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
    gridRef.current?.focus();
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
      case "b":
      case "B":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          const current = formatAt(rows[selected.row], columns[selected.col]?.id);
          return applyFormat({ bold: !current?.bold });
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
      const width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, state.startWidth + event.clientX - state.startX),
      );
      onChange({
        columns: columns.map((column, index) =>
          index === state.index ? { ...column, width } : column,
        ),
      });
    };
    const handleMouseUp = () => {
      resizeStateRef.current = null;
      dragRef.current = null;
      fillOriginRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [columns, onChange]);

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

  const toolbarGroups = [
    [
      {
        label: "Add column before",
        icon: BetweenVerticalStart,
        disabled: false,
        run: () => addColumn(selected.col),
      },
      {
        label: "Add column after",
        icon: BetweenVerticalEnd,
        disabled: false,
        run: () => addColumn(selected.col + 1),
      },
      {
        label: "Delete column",
        icon: Minus,
        disabled: columns.length <= 1,
        run: () => deleteColumn(selected.col),
      },
    ],
    [
      {
        label: "Add row before",
        icon: BetweenHorizontalStart,
        disabled: false,
        run: () => addRows(1, selected.row),
      },
      {
        label: "Add row after",
        icon: BetweenHorizontalEnd,
        disabled: false,
        run: () => addRows(1, selected.row + 1),
      },
      {
        label: "Delete row",
        icon: Minus,
        disabled: rows.length <= 1,
        run: () => deleteRow(selected.row),
      },
    ],
    [
      {
        label: "Clear cell",
        icon: Eraser,
        disabled: false,
        run: () =>
          patchCells((row, _address, column) => ({
            ...row,
            cells: { ...row.cells, [column.id]: "" },
          })),
      },
    ],
  ];

  const applyNumberFormat = (format: SheetNumberFormat) => {
    applyFormat({
      numberFormat: toggleNumberFormat(selectedFormat?.numberFormat, format),
    });
  };

  const bounds = normalizedRange(range);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-popover px-2 py-1">
        {toolbarGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0.5">
            {groupIndex > 0 && <span className="mx-0.5 h-5 w-px bg-border" />}
            {group.map((button) => {
              const Icon = button.icon;
              return (
                <button
                  key={button.label}
                  type="button"
                  title={button.label}
                  disabled={button.disabled}
                  onClick={button.run}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-popover/60 px-3 py-1.5">
        <span className="w-16 shrink-0 rounded-md border border-border bg-muted px-2 py-1 text-center font-mono text-xs font-semibold text-primary">
          {selectedAddress}
        </span>

        <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-input/30 px-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <span className="mr-2 shrink-0 font-mono text-xs italic text-muted-foreground">
            fx
          </span>
          <span className="mr-2 h-3.5 w-px bg-border" />
          <input
            value={editing ? draft : selectedRaw}
            onChange={(event) => {
              if (!editing) {
                startEditing(selected, event.target.value, "formulaBar");
              } else {
                setDraft(event.target.value);
              }
            }}
            onKeyDown={(event) => {
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

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Bold (⌘B)"
            onClick={() => applyFormat({ bold: !selectedFormat?.bold })}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-md text-xs font-bold transition-colors hover:bg-accent ${
              selectedFormat?.bold ? "bg-accent text-foreground" : "text-muted-foreground"
            }`}
          >
            <Bold className="size-3.5" />
          </button>
          <button
            type="button"
            title="Align"
            onClick={() =>
              applyFormat({
                align: cycleAlign(
                  selectedFormat?.align ?? defaultAlign(columns[selected.col]?.type),
                ),
              })
            }
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <AlignLeft className="size-3.5" />
          </button>
          <button
            type="button"
            title="Format Currency"
            onClick={() => applyNumberFormat("currency")}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-md font-mono text-xs transition-colors hover:bg-accent ${
              selectedFormat?.numberFormat === "currency" ||
              columns[selected.col]?.type === "currency"
                ? "bg-accent text-foreground"
                : "text-muted-foreground"
            }`}
          >
            $
          </button>
          <button
            type="button"
            title="Format Percent"
            onClick={() => applyNumberFormat("percent")}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-md font-mono text-xs transition-colors hover:bg-accent ${
              selectedFormat?.numberFormat === "percent"
                ? "bg-accent text-foreground"
                : "text-muted-foreground"
            }`}
          >
            %
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="Insert Column Right"
            onClick={() => addColumn(selected.col + 1)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Columns3 className="size-3.5" />
          </button>
          <div className="relative">
            <button
              type="button"
              title="Filter & Sort"
              onClick={() => setFilterOpen((open) => !open)}
              className={`flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent ${
                filterOpen || filterQuery ? "bg-accent text-foreground" : "text-muted-foreground"
              }`}
            >
              <Filter className="size-3.5" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-8 z-40 w-56 rounded-lg border border-border bg-popover p-2 shadow-xl">
                <input
                  autoFocus
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Filter rows..."
                  className="w-full rounded-md border border-border bg-input/30 px-2 py-1 text-xs outline-none focus:border-ring"
                />
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => sortByColumn(selected.col, "asc")}
                    className="flex-1 rounded-md bg-secondary px-2 py-1 text-[11px] text-secondary-foreground hover:bg-accent"
                  >
                    Sort A → Z
                  </button>
                  <button
                    type="button"
                    onClick={() => sortByColumn(selected.col, "desc")}
                    className="flex-1 rounded-md bg-secondary px-2 py-1 text-[11px] text-secondary-foreground hover:bg-accent"
                  >
                    Sort Z → A
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            title={canMerge ? "Merge Cells" : "Select more than one cell to merge"}
            disabled={!canMerge}
            onClick={() => onChange({ merges: toggleMerge(merges, range) })}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          >
            <Combine className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none"
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
                className={`group relative flex items-center gap-1.5 border-b border-r border-border px-2 py-1.5 ${
                  index >= bounds.minCol && index <= bounds.maxCol ? "bg-accent/60" : ""
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
                    className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 text-xs text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => setRenamingColumnIndex(index)}
                    onClick={() =>
                      setSelection({ col: index, row: selected.row })
                    }
                    title="Double-click to rename"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground"
                  >
                    {column.name}
                  </button>
                )}

                <div className="relative shrink-0">
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
                }`}
                style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
              >
                {rowIndex + 1}
              </div>

              {columns.map((column, colIndex) => {
                const address = { col: colIndex, row: rowIndex };
                if (coveredByMerge(merges, address)) {
                  return <div key={column.id} className="border-b border-r border-border" />;
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
                const isFillCorner =
                  colIndex === bounds.maxCol && rowIndex === bounds.maxRow;

                return (
                  <div
                    key={column.id}
                    onMouseDown={(event) => {
                      if (isEditing) return;
                      if (event.shiftKey) {
                        setSelection(address, true);
                      } else {
                        setSelection(address);
                      }
                      dragRef.current = "select";
                    }}
                    onMouseEnter={() => {
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
                    onClick={() => {
                      if (!isSelected) return;
                      if (column.type === "boolean" && !isFormulaValue(raw)) {
                        toggleBoolean(address);
                      }
                    }}
                    className={`relative min-w-0 border-b border-r border-border px-2 text-sm ${
                      inRange ? "bg-primary/10" : ""
                    } ${isSelected ? "z-10 ring-2 ring-inset ring-ring" : ""} ${
                      result.type === "error" ? "text-destructive" : ""
                    } ${evaluator.isFormula(colIndex, rowIndex) && result.type === "number" ? "text-primary" : ""}`}
                    style={{
                      height: merge && isMergeOrigin(merge, address)
                        ? ROW_HEIGHT * merge.rowSpan
                        : ROW_HEIGHT,
                      textAlign: align,
                      fontWeight: format?.bold ? 700 : undefined,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={cellInputRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitEdit()}
                        onKeyDown={(event) => {
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
                        className="absolute inset-0 w-full bg-card px-2 py-1 text-left font-sans text-sm text-foreground outline-none ring-2 ring-inset ring-ring"
                      />
                    ) : chip ? (
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${chip.className}`}
                      >
                        {chip.label}
                      </span>
                    ) : (
                      <span className="block truncate leading-8">{display}</span>
                    )}
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

      <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-popover px-3 text-[11px]">
        <div className="flex min-w-0 items-end gap-1 pt-1">
          {(tabs ?? []).map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`flex items-center gap-1 rounded-t border border-b-0 px-2 py-1 ${
                  active
                    ? "border-border bg-background text-foreground"
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
