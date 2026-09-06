"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Eraser,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import { SheetColumn, SheetRow } from "@/app/_types/types";
import {
  columnIndexToLetter,
  createSheetEvaluator,
} from "@/app/utils/sheetFormula";

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 640;
const ROW_HEADER_WIDTH = 52;

interface CellAddress {
  col: number;
  row: number;
}

export interface SheetGridProps {
  columns: SheetColumn[];
  rows: SheetRow[];
  onChange: (next: { columns?: SheetColumn[]; rows?: SheetRow[] }) => void;
}

const newColumnId = () => `col_${crypto.randomUUID()}`;
const newRowId = () => `row_${crypto.randomUUID()}`;

function emptyRow(columns: SheetColumn[]): SheetRow {
  const cells: Record<string, string> = {};
  columns.forEach((column) => {
    cells[column.id] = "";
  });
  return { id: newRowId(), cells };
}

export default function SheetGrid({ columns, rows, onChange }: SheetGridProps) {
  const [selected, setSelected] = useState<CellAddress>({ col: 0, row: 0 });
  const [editing, setEditing] = useState<CellAddress | null>(null);
  const [draft, setDraft] = useState("");
  const [renamingColumnIndex, setRenamingColumnIndex] = useState<number | null>(
    null,
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const editSourceRef = useRef<"cell" | "formulaBar">("cell");
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

  // Editing started from the formula bar must leave focus there.
  useEffect(() => {
    if (editing && editSourceRef.current === "cell") cellInputRef.current?.focus();
  }, [editing]);

  // ---- Mutations ----

  const setCellValue = (address: CellAddress, value: string) => {
    const column = columns[address.col];
    if (!column) return;

    onChange({
      rows: rows.map((row, index) =>
        index === address.row
          ? { ...row, cells: { ...row.cells, [column.id]: value } }
          : row,
      ),
    });
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
    });
  };

  const deleteColumn = (index: number) => {
    if (columns.length <= 1) return;

    const removed = columns[index];
    onChange({
      columns: columns.filter((_, columnIndex) => columnIndex !== index),
      rows: rows.map((row) => {
        const cells = { ...row.cells };
        delete cells[removed.id];
        return { ...row, cells };
      }),
    });

    setSelected((previous) => ({
      col: Math.max(0, Math.min(previous.col, columns.length - 2)),
      row: previous.row,
    }));
  };

  const addRow = (atIndex = rows.length) => {
    const nextRows = [...rows];
    nextRows.splice(atIndex, 0, emptyRow(columns));
    onChange({ rows: nextRows });
  };

  const deleteRow = (index: number) => {
    if (rows.length <= 1) return;

    onChange({ rows: rows.filter((_, rowIndex) => rowIndex !== index) });
    setSelected((previous) => ({
      col: previous.col,
      row: Math.max(0, Math.min(previous.row, rows.length - 2)),
    }));
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

  // ---- Editing ----

  const startEditing = (
    address: CellAddress,
    initialValue?: string,
    source: "cell" | "formulaBar" = "cell",
  ) => {
    editSourceRef.current = source;
    setSelected(address);
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
      setSelected({
        col: editing.col,
        row: Math.min(editing.row + 1, rows.length - 1),
      });
    }
    if (move === "right") {
      setSelected({
        col: Math.min(editing.col + 1, columns.length - 1),
        row: editing.row,
      });
    }

    if (!startedInFormulaBar || move !== "none") gridRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
    gridRef.current?.focus();
  };

  const moveSelection = (deltaCol: number, deltaRow: number) => {
    setSelected((previous) => ({
      col: Math.min(Math.max(previous.col + deltaCol, 0), columns.length - 1),
      row: Math.min(Math.max(previous.row + deltaRow, 0), rows.length - 1),
    }));
  };

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        return moveSelection(0, -1);
      case "ArrowDown":
        event.preventDefault();
        return moveSelection(0, 1);
      case "ArrowLeft":
        event.preventDefault();
        return moveSelection(-1, 0);
      case "ArrowRight":
        event.preventDefault();
        return moveSelection(1, 0);
      case "Tab":
        event.preventDefault();
        return moveSelection(event.shiftKey ? -1 : 1, 0);
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEditing(selected);
      case "Delete":
      case "Backspace":
        event.preventDefault();
        return setCellValue(selected, "");
      default:
        break;
    }

    // Any printable character replaces the cell and enters edit mode.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      startEditing(selected, event.key);
    }
  };

  // ---- Column resizing ----

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
  const selectedAddress = `${columnIndexToLetter(selected.col)}${selected.row + 1}`;

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
        run: () => addRow(selected.row),
      },
      {
        label: "Add row after",
        icon: BetweenHorizontalEnd,
        disabled: false,
        run: () => addRow(selected.row + 1),
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
        run: () => setCellValue(selected, ""),
      },
    ],
  ];

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

      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <span className="w-14 shrink-0 rounded-md border border-border bg-muted px-2 py-1 text-center font-mono text-xs text-muted-foreground">
          {selectedAddress}
        </span>

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
          placeholder="Enter a value or a formula like =SUM(A1:A5)"
          className="min-w-0 flex-1 rounded-md border border-border bg-input/30 px-2 py-1 font-mono text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-auto outline-none"
      >
        <div className="inline-block min-w-full">
          <div
            className="sticky top-0 z-20 grid bg-muted"
            style={{ gridTemplateColumns }}
          >
            <div className="sticky left-0 z-30 border-b border-r border-border bg-muted" />

            {columns.map((column, index) => (
              <div
                key={column.id}
                className={`group relative flex items-center gap-1.5 border-b border-r border-border px-2 py-1.5 ${
                  index === selected.col ? "bg-accent/60" : ""
                }`}
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
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
                    onClick={() => setSelected({ col: index, row: selected.row })}
                    title="Double-click to rename"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground"
                  >
                    {column.name}
                  </button>
                )}

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
              className="flex cursor-pointer items-center justify-center border-b border-border transition-colors hover:bg-accent"
            >
              <Plus className="size-4" />
            </button>
          </div>

          {rows.map((row, rowIndex) => (
            <div key={row.id} className="grid" style={{ gridTemplateColumns }}>
              <div
                className={`sticky left-0 z-10 border-b border-r border-border px-2 py-1 text-center font-mono text-[11px] text-muted-foreground ${
                  rowIndex === selected.row ? "bg-accent/60" : "bg-muted"
                }`}
              >
                {rowIndex + 1}
              </div>

              {columns.map((column, colIndex) => {
                const isSelected =
                  selected.col === colIndex && selected.row === rowIndex;
                const isEditing =
                  editing?.col === colIndex && editing?.row === rowIndex;
                const result = evaluator.valueAt(colIndex, rowIndex);
                const display = evaluator.displayAt(colIndex, rowIndex);

                return (
                  <div
                    key={column.id}
                    onMouseDown={() => {
                      if (!isEditing) setSelected({ col: colIndex, row: rowIndex });
                    }}
                    onDoubleClick={() =>
                      startEditing({ col: colIndex, row: rowIndex })
                    }
                    className={`relative min-w-0 border-b border-r border-border px-2 py-1 text-sm ${
                      isSelected ? "ring-2 ring-inset ring-ring" : ""
                    } ${result.type === "number" ? "text-right font-mono" : ""} ${
                      result.type === "error" ? "text-destructive" : ""
                    }`}
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
                    ) : (
                      <span className="block truncate">{display}</span>
                    )}
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
              onClick={() => addRow()}
              className="sticky left-0 z-10 flex cursor-pointer items-center justify-center border-b border-r border-border bg-muted py-1 transition-colors hover:bg-accent"
            >
              <Plus className="size-3.5" />
            </button>
            <div className="border-b border-border" />
          </div>
        </div>
      </div>
    </div>
  );
}
