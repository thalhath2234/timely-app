import type { Sheet, SheetColumn, SheetRow, SheetTab } from "@/app/_types/types";
import { newColumnId, newRowId, newTabId } from "@/app/utils/sheetColumns";
import { columnIndexToLetter } from "@timely/contract/sheetFormula";

export function emptySheetRow(columns: SheetColumn[]): SheetRow {
  const cells: Record<string, string> = {};
  columns.forEach((column) => {
    cells[column.id] = "";
  });
  return { id: newRowId(), cells };
}

export function defaultTabGrid(): { columns: SheetColumn[]; rows: SheetRow[] } {
  const columns: SheetColumn[] = ["A", "B", "C", "D"].map((name) => ({
    id: newColumnId(),
    name,
    width: 160,
    type: "text",
  }));
  const rows = Array.from({ length: 20 }, () => emptySheetRow(columns));
  return { columns, rows };
}

/** Works for sheets and templates (pass a template's name as `title`). */
export function tabsFromSheet(
  sheet: Pick<Sheet, "title" | "columns" | "rows" | "merges" | "tabs">,
): SheetTab[] {
  if (sheet.tabs && sheet.tabs.length > 0) {
    return sheet.tabs.map((tab, index) => ({
      ...tab,
      id: tab.id || newTabId(),
      name: tab.name?.trim() || (index === 0 ? sheet.title || "Sheet 1" : `Sheet ${index + 1}`),
      merges: tab.merges ?? [],
    }));
  }
  return [
    {
      id: newTabId(),
      name: sheet.title || "Sheet 1",
      columns: sheet.columns,
      rows: sheet.rows,
      merges: sheet.merges ?? [],
    },
  ];
}

/**
 * The primary grid is mirrored onto columns/rows/merges for older readers,
 * and every tab (including the first) is sent so its own name survives.
 */
export function workbookPayload(tabs: SheetTab[]) {
  const primary = tabs[0];
  return {
    columns: primary?.columns ?? [],
    rows: primary?.rows ?? [],
    merges: primary?.merges ?? [],
    tabs,
  };
}

export function addWorkbookTab(tabs: SheetTab[], from?: SheetTab): SheetTab[] {
  if (from) {
    return [
      ...tabs,
      {
        ...from,
        id: from.id || newTabId(),
        name: from.name?.trim() || `Sheet ${tabs.length + 1}`,
        merges: from.merges ?? [],
      },
    ];
  }
  const grid = defaultTabGrid();
  return [
    ...tabs,
    {
      id: newTabId(),
      name: `Sheet ${tabs.length + 1}`,
      columns: grid.columns.map((column, index) => ({
        ...column,
        name: column.name || columnIndexToLetter(index),
      })),
      rows: grid.rows,
      merges: [],
    },
  ];
}

export function templateTabChoices(template: {
  name: string;
  tabs?: SheetTab[] | null;
}): { id: string; name: string }[] {
  if (template.tabs && template.tabs.length > 0) {
    return template.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name?.trim() || template.name || "Sheet",
    }));
  }
  return [{ id: "", name: template.name?.trim() || "Sheet 1" }];
}

export function sheetMetaLabel(sheet: Pick<Sheet, "columns" | "rows" | "updatedAt">) {
  return `${sheet.rows.length} rows · ${sheet.columns.length} cols · ${formatSheetDate(sheet.updatedAt)}`;
}

export function formatSheetDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday.getTime() - startTarget.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
